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

  // 번역 큐: 세그먼트를 절대 드랍하지 않음
  private translationQueues: Map<string, Array<{ text: string; sequence: number }>> = new Map();
  private translationProcessing: Map<string, boolean> = new Map();

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

      // Audio handlers
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
   * STT 콜백 설정
   * TextAccumulator가 축적한 텍스트를 전달 → 큐에 넣고 순차 번역
   */
  private async setupSttCallbacks(roomCode: string, promptTemplate?: string): Promise<void> {
    await this.sttManager.createClient(
      roomCode,
      async (transcriptData) => {
        if (!transcriptData.isFinal) {
          // Interim → stt-text (스피커 화면 실시간 표시)
          this.io.to(transcriptData.roomId).emit('stt-text', {
            text: transcriptData.text,
            timestamp: transcriptData.timestamp.getTime(),
            isFinal: false
          });
          return;
        }

        // Final (TextAccumulator가 축적한 텍스트) → 번역 큐
        const roomId = transcriptData.roomId;
        const text = transcriptData.text;

        // 1. SessionService에 세그먼트 추가
        const sequence = this.sessionService.addSegment(roomId, text);

        // 2. stt-text final 전송
        this.io.to(roomId).emit('stt-text', {
          text,
          timestamp: transcriptData.timestamp.getTime(),
          isFinal: true
        });

        // 3. 번역 큐에 추가 (절대 드랍하지 않음)
        this.enqueueTranslation(roomId, text, sequence);
      },
      undefined,
      promptTemplate || 'general'
    );
  }

  /**
   * 번역 큐 — 세그먼트를 절대 드랍하지 않고 순차 처리
   */
  private enqueueTranslation(roomId: string, text: string, sequence: number): void {
    if (!this.translationQueues.has(roomId)) {
      this.translationQueues.set(roomId, []);
    }
    this.translationQueues.get(roomId)!.push({ text, sequence });

    // 이미 처리 중이면 큐에만 넣고 리턴 (처리 루프가 꺼내감)
    if (this.translationProcessing.get(roomId)) return;

    this.processTranslationQueue(roomId);
  }

  /**
   * 큐 처리 루프 — 큐가 빌 때까지 순차 번역
   */
  private async processTranslationQueue(roomId: string): Promise<void> {
    this.translationProcessing.set(roomId, true);

    try {
      while (true) {
        const queue = this.translationQueues.get(roomId);
        if (!queue || queue.length === 0) break;

        const item = queue.shift()!;
        await this.translateAndEmit(roomId, item.text, item.sequence);
      }
    } catch (error) {
      console.error(`[SocketHandler][${roomId}] Translation queue error:`, error);
    } finally {
      this.translationProcessing.set(roomId, false);
    }
  }

  /**
   * 단일 세그먼트 번역 + emit
   */
  private async translateAndEmit(roomId: string, text: string, sequence: number): Promise<void> {
    const room = await this.roomService.getRoom(roomId);
    if (!room) return;

    const targetLanguages = room.roomSettings?.targetLanguagesArray || ['en'];

    try {
      const translateStart = Date.now();
      const result = await this.translationService.translate(
        text,
        targetLanguages,
        {
          summary: this.sessionService.getSummary(roomId),
          recentKorean: this.sessionService.getRecentContext(roomId),
          recentTranslationHistory: this.sessionService.getRecentTranslationHistory(roomId),
          glossary: room.roomSettings?.customGlossary || undefined,
        }
      );
      const latencyMs = Date.now() - translateStart;

      if (result && Object.keys(result.translations).length > 0) {
        // 보정된 한국어로 컨텍스트 업데이트
        this.sessionService.updateCorrectedSegment(roomId, result.korean);

        // 번역 히스토리 업데이트 (문맥 연속성)
        this.sessionService.addTranslationHistory(roomId, result.translations);

        const segmentId = uuidv4();

        // segment 이벤트 전송 (LLM이 보정한 korean 사용)
        this.io.to(roomId).emit('segment', {
          id: segmentId,
          korean: result.korean,
          translations: result.translations,
          timestamp: Date.now(),
          sequence,
        });

        // 비동기 DB 저장
        this.transcriptService.saveSegment(
          roomId, sequence, text, result.korean, result.translations, latencyMs
        ).catch(err => {
          console.error(`[SocketHandler][${roomId}] Segment save error:`, err);
        });

        // 비동기 요약 재생성
        if (this.sessionService.shouldRegenerateSummary(roomId)) {
          this.regenerateSummary(roomId).catch(err => {
            console.error(`[SocketHandler][${roomId}] Summary error:`, err);
          });
        }
      }
    } catch (error) {
      console.error(`[SocketHandler][${roomId}] Translation error:`, error);
    }
  }

  /**
   * 요약 재생성 (비동기)
   */
  private async regenerateSummary(roomCode: string): Promise<void> {
    const recentContext = this.sessionService.getRecentContext(roomCode);
    const previousSummary = this.sessionService.getSummary(roomCode);

    const newSummary = await this.translationService.generateSummary(recentContext, previousSummary);
    if (newSummary) {
      this.sessionService.updateSummary(roomCode, newSummary);
    }
  }

  // Send transcript history (STT texts)
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

  /**
   * 룸 번역 큐 정리 (disconnect 시 호출 가능)
   */
  cleanupRoom(roomId: string): void {
    this.translationQueues.delete(roomId);
    this.translationProcessing.delete(roomId);
  }
}
