import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { RoomService } from '../room/room-service';
import { TranscriptService } from '../room/transcript-service';
import { STTManager } from '../stt/stt-manager';
import { TranslationService } from '../translation/translation-service';
import { SessionService } from '../../services/session-service';
import { recordingStateService } from '../../services/recording-state-service';
import { attachUserIdToSocket, AuthenticatedSocket } from '../../middleware/socket-auth';
import {
  HandlerContext,
  AudioStreamData,
  handleCreateRoom,
  handleRejoinRoom,
  handleJoinRoom,
  handleDisconnect,
  handleAudioBlob,
  handleAudioStream,
  handleStartRecording,
  handleStopRecording,
  handleUpdateSettings
} from './handlers';

export class SocketHandler {
  private io: Server;
  private roomService: RoomService;
  private transcriptService: TranscriptService;
  private sttManager: STTManager;
  private translationService: TranslationService;
  private sessionService: SessionService;
  private audioChunksReceived: Map<string, number> = new Map();

  constructor(
    io: Server,
    roomService: RoomService,
    transcriptService: TranscriptService,
    sttManager: STTManager,
    translationService: TranslationService,
    sessionService: SessionService
  ) {
    this.io = io;
    this.roomService = roomService;
    this.transcriptService = transcriptService;
    this.sttManager = sttManager;
    this.translationService = translationService;
    this.sessionService = sessionService;
    this.initialize();
    recordingStateService.setSocketIO(io);
  }

  private getContext(): HandlerContext {
    return {
      io: this.io,
      roomService: this.roomService,
      transcriptService: this.transcriptService,
      sttManager: this.sttManager,
      translationService: this.translationService,
      sessionService: this.sessionService,
      audioChunksReceived: this.audioChunksReceived,
      setupSttCallbacks: this.setupSttCallbacks.bind(this),
      sendTranscriptHistory: this.sendTranscriptHistory.bind(this),
      sendTranslationHistory: this.sendTranslationHistory.bind(this),
      translateHistoricalTexts: this.translateHistoricalTexts.bind(this)
    };
  }

  private initialize(): void {
    this.io.on('connection', (socket: Socket) => {
      attachUserIdToSocket(socket as AuthenticatedSocket);
      const ctx = this.getContext();

      // Room handlers
      socket.on('create-room', (data) => handleCreateRoom(ctx, socket, data));
      socket.on('rejoin-room', (data) => handleRejoinRoom(ctx, socket, data));
      socket.on('join-room', (data) => handleJoinRoom(ctx, socket, data));

      // Audio handlers (audio-stream + audio-blob → both still accepted)
      socket.on('audio-stream', (data: AudioStreamData) => handleAudioStream(ctx, socket, data));
      socket.on('audio-blob', (data) => handleAudioBlob(ctx, socket, data));

      // Recording handlers
      socket.on('start-recording', (data) => handleStartRecording(ctx, socket, data));
      socket.on('stop-recording', (data) => handleStopRecording(ctx, socket, data));

      // Settings handler
      socket.on('update-settings', (data) => handleUpdateSettings(ctx, socket, data));

      // History request
      socket.on('request-history', async (data) => {
        await this.sendTranscriptHistory(socket, data.roomId);
      });

      // Disconnect handler
      socket.on('disconnect', () => handleDisconnect(ctx, socket));
    });
  }

  /**
   * STT 클라이언트 생성 + 콜백 설정
   * Deepgram final → SessionService에 세그먼트 추가 → 즉시 번역 → segment 이벤트 전송
   */
  private async setupSttCallbacks(roomCode: string, promptTemplate?: string): Promise<void> {
    await this.sttManager.createClient(
      roomCode,
      async (transcriptData) => {
        if (!transcriptData.isFinal) {
          // Interim → stt-text 이벤트 (기존 호환성 유지)
          this.io.to(transcriptData.roomId).emit('stt-text', {
            text: transcriptData.text,
            timestamp: transcriptData.timestamp.getTime(),
            isFinal: false
          });
          return;
        }

        // Final transcript → 즉시 번역 파이프라인
        const roomId = transcriptData.roomId;
        const text = transcriptData.text;

        // 1. SessionService에 세그먼트 추가
        const sequence = this.sessionService.addSegment(roomId, text);

        // 2. stt-text 이벤트 전송 (기존 호환성 + 스피커 화면 표시)
        this.io.to(roomId).emit('stt-text', {
          text,
          timestamp: transcriptData.timestamp.getTime(),
          isFinal: true
        });

        // 3. 번역 (동시 번역 방지)
        if (this.sessionService.isTranslationInFlight(roomId)) {
          return;
        }

        const room = await this.roomService.getRoom(roomId);
        if (!room) return;

        const targetLanguages = room.roomSettings?.targetLanguagesArray || ['en'];

        this.sessionService.setTranslationInFlight(roomId, true);

        try {
          const translateStart = Date.now();
          const result = await this.translationService.translate(
            text,
            targetLanguages,
            {
              summary: this.sessionService.getSummary(roomId),
              recentKorean: this.sessionService.getRecentContext(roomId),
              previousTranslations: this.sessionService.getPreviousTranslations(roomId),
              recentTranslationHistory: this.sessionService.getRecentTranslationHistory(roomId),
              glossary: room.roomSettings?.customGlossary || undefined,
            }
          );
          const latencyMs = Date.now() - translateStart;

          if (result && Object.keys(result.translations).length > 0) {
            // 4. 이전 번역 업데이트
            this.sessionService.updatePreviousTranslations(roomId, result.translations);

            const segmentId = uuidv4();

            // 5. segment 이벤트 전송 (새 포맷)
            this.io.to(roomId).emit('segment', {
              id: segmentId,
              korean: result.korean,
              translations: result.translations,
              timestamp: Date.now(),
              sequence,
            });

            // 6. 비동기 DB 저장 (Segment)
            this.transcriptService.saveSegment(
              roomId, sequence, text, result.korean, result.translations, latencyMs
            ).catch(err => {
              console.error(`[SocketHandler][${roomId}] Segment save error:`, err);
            });

            // 7. 비동기 요약 재생성
            if (this.sessionService.shouldRegenerateSummary(roomId)) {
              this.regenerateSummary(roomId).catch(err => {
                console.error(`[SocketHandler][${roomId}] Summary error:`, err);
              });
            }
          }
        } catch (error) {
          console.error(`[SocketHandler][${roomId}] Translation error:`, error);
        } finally {
          this.sessionService.setTranslationInFlight(roomId, false);
        }
      },
      undefined,
      promptTemplate || 'general'
    );
  }

  /**
   * 요약 재생성 (비동기)
   */
  private async regenerateSummary(roomCode: string): Promise<void> {
    const fullContext = this.sessionService.getFullContext(roomCode);
    const previousSummary = this.sessionService.getSummary(roomCode);

    const newSummary = await this.translationService.generateSummary(fullContext, previousSummary);
    if (newSummary) {
      this.sessionService.updateSummary(roomCode, newSummary);
    }
  }

  // Send transcript history
  private async sendTranscriptHistory(socket: Socket, roomId: string): Promise<void> {
    try {
      const transcripts = await this.transcriptService.getRecentSttTexts(roomId, 50);

      transcripts.reverse().forEach((transcript: any) => {
        socket.emit('stt-text', {
          text: transcript.text,
          timestamp: transcript.timestamp ? new Date(transcript.timestamp).getTime() : Date.now(),
          isFinal: true,
          isHistory: true
        });
      });

    } catch (error) {
      console.error('[History] Error loading transcripts:', error);
    }
  }

  // Send translation history (Segment-based)
  private async sendTranslationHistory(socket: Socket, roomId: string): Promise<void> {
    try {
      const segments = await this.transcriptService.getAllSegments(roomId);

      for (const seg of segments) {
        socket.emit('segment', {
          id: seg.id,
          korean: seg.koreanCorrected,
          translations: seg.translations || {},
          timestamp: seg.timestamp ? new Date(seg.timestamp).getTime() : Date.now(),
          sequence: seg.sequence,
          isHistory: true,
        });

      }

    } catch (error) {
      console.error('[History] Error loading segments:', error);
    }
  }

  // Translate historical (untranslated) STT texts
  private async translateHistoricalTexts(roomCode: string): Promise<void> {
    try {
      const untranslatedTexts = await this.transcriptService.getUntranslatedSttTexts(roomCode);

      if (untranslatedTexts.length === 0) {
        return;
      }

      console.log(`[HistoricalTranslation][${roomCode}] Found ${untranslatedTexts.length} untranslated texts`);

      const room = await this.roomService.getRoom(roomCode);
      if (!room) return;

      const targetLanguages = room.roomSettings?.targetLanguagesArray
        || (typeof room.roomSettings?.targetLanguages === 'string'
            ? room.roomSettings.targetLanguages.split(',').filter((l: string) => l.trim())
            : room.roomSettings?.targetLanguages)
        || ['en'];

      for (const sttText of untranslatedTexts) {
        const translateStart = Date.now();
        const result = await this.translationService.translate(
          sttText.text,
          targetLanguages,
          {
            summary: this.sessionService.getSummary(roomCode),
            recentKorean: this.sessionService.getRecentContext(roomCode),
            previousTranslations: this.sessionService.getPreviousTranslations(roomCode),
          }
        );
        const latencyMs = Date.now() - translateStart;

        if (result && Object.keys(result.translations).length > 0) {
          const sequence = this.sessionService.addSegment(roomCode, result.korean);
          this.sessionService.updatePreviousTranslations(roomCode, result.translations);

          // Save as Segment
          await this.transcriptService.saveSegment(
            roomCode, sequence, sttText.text, result.korean, result.translations, latencyMs
          );

          const segmentId = uuidv4();
          this.io.to(roomCode).emit('segment', {
            id: segmentId,
            korean: result.korean,
            translations: result.translations,
            timestamp: Date.now(),
            sequence,
          });

        }
      }

    } catch (error) {
      console.error(`[HistoricalTranslation][${roomCode}] Error:`, error);
    }
  }
}
