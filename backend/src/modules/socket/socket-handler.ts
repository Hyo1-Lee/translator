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

  // 번역 큐
  private translationQueues: Map<string, Array<{ text: string; forceComplete: boolean }>> = new Map();
  private translationProcessing: Map<string, boolean> = new Map();

  // carry-over: LLM이 미완성으로 판단한 텍스트 이월
  private carryoverBuffer: Map<string, string> = new Map();

  // 최근 세그먼트: 비동기 refinement용
  private recentSegmentData: Map<string, Array<{
    id: string;
    sourceText: string;
    translations: Record<string, string>;
    sequence: number;
  }>> = new Map();

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
      cleanupTranslationState: this.cleanupRoom.bind(this),
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
   * TextAccumulator가 축적한 텍스트를 전달 → carry-over 파이프라인으로 순차 처리
   */
  private async setupSttCallbacks(roomCode: string, promptTemplate?: string, sourceLanguage?: string): Promise<void> {
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

        const roomId = transcriptData.roomId;
        const text = transcriptData.text;
        const forceComplete = transcriptData.forceComplete || false;

        // stt-text final 전송 (스피커 화면에 즉시 표시)
        this.io.to(roomId).emit('stt-text', {
          text,
          timestamp: transcriptData.timestamp.getTime(),
          isFinal: true
        });

        // 번역 큐에 추가
        this.enqueueTranslation(roomId, text, forceComplete);
      },
      undefined,
      promptTemplate || 'general',
      sourceLanguage,
    );
  }

  /**
   * 번역 큐 — 순차 처리 (carry-over 포함)
   */
  private enqueueTranslation(roomId: string, text: string, forceComplete: boolean): void {
    if (!this.translationQueues.has(roomId)) {
      this.translationQueues.set(roomId, []);
    }
    this.translationQueues.get(roomId)!.push({ text, forceComplete });

    if (this.translationProcessing.get(roomId)) return;

    this.processTranslationQueue(roomId);
  }

  /**
   * 큐 처리 루프 — carry-over + 3중 방어 파이프라인
   */
  private async processTranslationQueue(roomId: string): Promise<void> {
    this.translationProcessing.set(roomId, true);

    try {
      while (true) {
        const queue = this.translationQueues.get(roomId);
        if (!queue || queue.length === 0) break;

        const item = queue.shift()!;
        await this.processSegment(roomId, item.text, item.forceComplete);
      }
    } catch (error) {
      console.error(`[SocketHandler][${roomId}] Translation queue error:`, error);
    } finally {
      this.translationProcessing.set(roomId, false);
    }
  }

  /**
   * 3중 방어 파이프라인: carry-over + correctAndCheck + translate + refinement
   */
  private async processSegment(roomId: string, rawText: string, forceComplete: boolean): Promise<void> {
    const room = await this.roomService.getRoom(roomId);
    if (!room) return;

    const targetLanguages = room.roomSettings?.targetLanguagesArray || ['en'];
    const sourceLanguage = room.roomSettings?.sourceLanguage || 'ko';

    try {
      // 1. carry-over 합치기
      const carryover = this.carryoverBuffer.get(roomId) || '';
      const fullText = carryover ? carryover + ' ' + rawText : rawText;
      this.carryoverBuffer.delete(roomId);

      // 2. Pass 1: 보정 + 완성 여부 판별 (Layer 2: LLM 체크)
      const translateStart = Date.now();
      const preset = room.roomSettings?.environmentPreset || 'general';
      const customDesc = room.roomSettings?.customEnvironmentDescription || '';
      const envDesc = customDesc || (preset !== 'general' ? `Session type: ${preset}` : '');
      const { corrected, isComplete } = await this.translationService.correctAndCheck(
        fullText,
        sourceLanguage,
        {
          summary: this.sessionService.getSummary(roomId),
          recentSourceText: this.sessionService.getRecentContext(roomId),
          environmentDescription: envDesc,
        }
      );

      // 3. 미완성 → carry-over 저장 (안전장치: 300자 초과 시 강제 번역)
      if (!isComplete && !forceComplete && corrected.length <= 300) {
        this.carryoverBuffer.set(roomId, corrected);
        return;
      }

      // 4. SessionService에 세그먼트 추가
      const sequence = this.sessionService.addSegment(roomId, corrected);

      // 5. Pass 2: 번역
      const translations = await this.translationService.translateText(
        corrected,
        targetLanguages,
        sourceLanguage,
        {
          summary: this.sessionService.getSummary(roomId),
          recentTranslationHistory: this.sessionService.getRecentTranslationHistory(roomId),
          glossary: room.roomSettings?.customGlossary || undefined,
          environmentDescription: envDesc,
        }
      );
      const latencyMs = Date.now() - translateStart;

      if (Object.keys(translations).length > 0) {
        // 컨텍스트 업데이트
        this.sessionService.updateCorrectedSegment(roomId, corrected);
        this.sessionService.addTranslationHistory(roomId, translations);

        const segmentId = uuidv4();

        // segment 이벤트 전송
        this.io.to(roomId).emit('segment', {
          id: segmentId,
          sourceText: corrected,
          translations,
          timestamp: Date.now(),
          sequence,
        });

        // refinement용 저장 + 이전 세그먼트 개선 트리거
        this.storeAndRefine(roomId, { id: segmentId, sourceText: corrected, translations, sequence }, targetLanguages, sourceLanguage, envDesc);

        // 비동기 DB 저장
        this.transcriptService.saveSegment(
          roomId, sequence, rawText, corrected, translations, latencyMs, undefined, sourceLanguage
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
   * 세그먼트 저장 + 이전 세그먼트 비동기 refinement 트리거
   */
  private storeAndRefine(
    roomId: string,
    segment: { id: string; sourceText: string; translations: Record<string, string>; sequence: number },
    targetLanguages: string[],
    sourceLanguage: string,
    environmentDescription?: string,
  ): void {
    if (!this.recentSegmentData.has(roomId)) {
      this.recentSegmentData.set(roomId, []);
    }
    const segments = this.recentSegmentData.get(roomId)!;
    segments.push(segment);

    // 최대 5개 유지
    if (segments.length > 5) segments.shift();

    // 이전 세그먼트가 있으면 refinement 트리거
    if (segments.length >= 2) {
      const target = segments[segments.length - 2];
      const before = segments.length >= 3 ? segments[segments.length - 3] : null;
      const after = segments[segments.length - 1];

      this.refineSegment(roomId, target, before, after, targetLanguages, sourceLanguage, environmentDescription).catch(err => {
        console.error(`[SocketHandler][${roomId}] Refinement error:`, err);
      });
    }
  }

  /**
   * 비동기 세그먼트 번역 개선
   */
  private async refineSegment(
    roomId: string,
    target: { id: string; sourceText: string; translations: Record<string, string>; sequence: number },
    before: { sourceText: string } | null,
    after: { sourceText: string },
    targetLanguages: string[],
    sourceLanguage: string,
    environmentDescription?: string,
  ): Promise<void> {
    const improved = await this.translationService.refineTranslation(
      before?.sourceText || '',
      target.sourceText,
      after.sourceText,
      target.translations,
      targetLanguages,
      sourceLanguage,
      environmentDescription,
    );

    if (improved) {
      // 1. 사용자에게 업데이트 전송
      this.io.to(roomId).emit('segment-update', {
        id: target.id,
        translations: improved,
      });

      // 2. 인메모리 데이터 업데이트
      target.translations = improved;

      // 3. DB 업데이트 (비동기)
      this.transcriptService.updateSegmentTranslations(
        roomId, target.sequence, improved
      ).catch(err => {
        console.error(`[SocketHandler][${roomId}] Refinement DB update error:`, err);
      });
    }
  }

  /**
   * 요약 재생성 (비동기)
   */
  private async regenerateSummary(roomCode: string): Promise<void> {
    const room = await this.roomService.getRoom(roomCode);
    const sourceLanguage = room?.roomSettings?.sourceLanguage || 'ko';
    const recentContext = this.sessionService.getRecentContext(roomCode);
    const previousSummary = this.sessionService.getSummary(roomCode);

    const newSummary = await this.translationService.generateSummary(recentContext, previousSummary, sourceLanguage);
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
          sourceText: seg.sourceCorrected,
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
    this.carryoverBuffer.delete(roomId);
    this.recentSegmentData.delete(roomId);
  }
}
