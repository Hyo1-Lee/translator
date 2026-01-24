import { Server, Socket } from 'socket.io';
import { RoomService } from '../room/room-service';
import { TranscriptService } from '../room/transcript-service';
import { STTManager } from '../stt/stt-manager';
import { TranslationService } from '../translation/translation-service';
import { AzureTranslateService, SUPPORTED_LANGUAGES } from '../translation/azure-translate.service';
import { TranslationManager, TranslationData } from '../translation/translation-manager';
import { EnvironmentPreset } from '../translation/presets';
import { recordingStateService } from '../../services/recording-state-service';
import { attachUserIdToSocket, AuthenticatedSocket } from '../../middleware/socket-auth';
import {
  HandlerContext,
  AudioStreamData,
  SttIdCacheEntry,
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
  private azureTranslateService: AzureTranslateService;
  private translationManagers: Map<string, TranslationManager> = new Map();
  private sttIdCache: Map<string, Map<string, SttIdCacheEntry>> = new Map();
  private audioChunksReceived: Map<string, number> = new Map();

  // 캐시 크기 제한 (메모리 누수 방지)
  private readonly MAX_CACHE_SIZE_PER_ROOM = 500;

  constructor(
    io: Server,
    roomService: RoomService,
    transcriptService: TranscriptService,
    sttManager: STTManager,
    translationService: TranslationService,
    azureTranslateService: AzureTranslateService
  ) {
    this.io = io;
    this.roomService = roomService;
    this.transcriptService = transcriptService;
    this.sttManager = sttManager;
    this.translationService = translationService;
    this.azureTranslateService = azureTranslateService;
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
      azureTranslateService: this.azureTranslateService,
      translationManagers: this.translationManagers,
      sttIdCache: this.sttIdCache,
      audioChunksReceived: this.audioChunksReceived,
      createTranslationManager: this.createTranslationManager.bind(this),
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

  // Send translation history
  private async sendTranslationHistory(socket: Socket, roomId: string): Promise<void> {
    try {
      const translationsByLanguage = await this.transcriptService.getAllTranslationTexts(roomId);

      for (const [language, translations] of Object.entries(translationsByLanguage)) {
        (translations as any[]).forEach((translation: any) => {
          socket.emit('translation-text', {
            targetLanguage: translation.targetLanguage,
            text: translation.translatedText,
            originalText: translation.originalText,
            isPartial: false,
            contextSummary: translation.contextSummary,
            timestamp: translation.timestamp ? new Date(translation.timestamp).getTime() : Date.now(),
            isHistory: true
          });
        });
      }

      console.log(`[History][${roomId}] Sent translation history for ${Object.keys(translationsByLanguage).length} languages`);

    } catch (error) {
      console.error('[History] Error loading translations:', error);
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

      // Get or create TranslationManager
      let translationManager = this.translationManagers.get(roomCode);

      if (!translationManager) {
        const room = await this.roomService.getRoom(roomCode);
        if (!room) {
          console.error(`[HistoricalTranslation][${roomCode}] Room not found`);
          return;
        }
        await this.createTranslationManager(roomCode, room.roomSettings || {});
        translationManager = this.translationManagers.get(roomCode);
      }

      if (!translationManager) {
        console.error(`[HistoricalTranslation][${roomCode}] Failed to get TranslationManager`);
        return;
      }

      // Pre-populate the sttIdCache with existing STT text IDs
      if (!this.sttIdCache.has(roomCode)) {
        this.sttIdCache.set(roomCode, new Map());
      }
      const roomCache = this.sttIdCache.get(roomCode)!;
      const now = Date.now();

      for (const sttText of untranslatedTexts) {
        roomCache.set(sttText.text, { id: sttText.id, timestamp: now });
        translationManager.addTranscript(sttText.text, true, sttText.confidence);
      }

    } catch (error) {
      console.error(`[HistoricalTranslation][${roomCode}] Error:`, error);
    }
  }

  // Create TranslationManager for a room
  private async createTranslationManager(
    roomCode: string,
    roomSettings: any
  ): Promise<void> {
    try {
      const sourceLanguage = roomSettings.sourceLanguage || 'ko';
      // 스피커가 선택한 언어 사용 (없으면 기본값 ['en'])
      const targetLanguages = roomSettings.targetLanguagesArray
        || (typeof roomSettings.targetLanguages === 'string'
            ? roomSettings.targetLanguages.split(',').filter((l: string) => l.trim())
            : roomSettings.targetLanguages)
        || ['en'];

      const translationManager = new TranslationManager({
        roomId: roomCode,
        sourceLanguage: roomSettings.sourceLanguage || 'ko',
        environmentPreset: (roomSettings.environmentPreset as EnvironmentPreset) || 'general',
        customEnvironmentDescription: roomSettings.customEnvironmentDescription,
        customGlossary: roomSettings.customGlossary,
        targetLanguages,
        enableStreaming: roomSettings.enableStreaming ?? true,
        translationService: this.translationService,
        azureTranslateService: this.azureTranslateService,
        onTranslation: async (data: TranslationData) => {
          await this.handleTranslationData(roomCode, data);
        },
        onError: (error: Error) => {
          console.error(`[TranslationManager][${roomCode}] Error:`, error);
        }
      });

      this.translationManagers.set(roomCode, translationManager);
      console.log(`[TranslationManager][${roomCode}] Created (${targetLanguages.length} languages)`);

    } catch (error) {
      console.error(`[TranslationManager][${roomCode}] Failed to create:`, error);
      throw error;
    }
  }

  // Handle translation data
  private async handleTranslationData(roomCode: string, data: TranslationData): Promise<void> {
    try {
      let sttTextId: string | undefined;

      // Initialize cache for this room if not exists
      if (!this.sttIdCache.has(roomCode)) {
        this.sttIdCache.set(roomCode, new Map());
      }
      const roomCache = this.sttIdCache.get(roomCode)!;

      // Clean up old cache entries (older than 30 seconds)
      const now = Date.now();
      for (const [text, entry] of roomCache.entries()) {
        if (now - entry.timestamp > 30000) {
          roomCache.delete(text);
        }
      }

      // 캐시 크기 제한 적용 (메모리 누수 방지)
      this.cleanupSttIdCache(roomCode);

      // Skip saving partial translations (streaming)
      if (data.isPartial) {
        this.io.to(roomCode).emit('translation-text', {
          targetLanguage: data.targetLanguage,
          text: data.translatedText,
          originalText: data.originalText,
          isPartial: true,
          contextSummary: data.contextSummary,
          timestamp: data.timestamp.getTime()
        });
        return;
      }

      // Check if we already saved STT text for this originalText
      const cachedEntry = roomCache.get(data.originalText);
      if (cachedEntry) {
        sttTextId = cachedEntry.id;
      } else if (!data.sttTextId) {
        // Save STT text on first translation only
        const savedStt = await this.transcriptService.saveSttText(
          roomCode,
          data.originalText,
          data.confidence
        );
        sttTextId = savedStt?.id;

        if (sttTextId) {
          roomCache.set(data.originalText, { id: sttTextId, timestamp: now });
        }
      }

      // Batch mode: save all translations and emit as single batch event
      if (data.isBatch && data.translations) {
        // Save all translations to DB (병렬 저장)
        const savePromises = Object.entries(data.translations).map(([lang, translatedText]) =>
          this.transcriptService.saveTranslationText(
            roomCode,
            lang,
            data.originalText,
            translatedText,
            data.contextSummary,
            false,
            sttTextId
          )
        );
        await Promise.all(savePromises);

        const batchPayload = {
          korean: data.originalText,
          english: data.translations['en'] || data.translatedText,
          translations: data.translations,
          timestamp: data.timestamp.getTime(),
          batchId: `${roomCode}-${data.timestamp.getTime()}`
        };

        this.io.to(roomCode).emit('translation-batch', batchPayload);
        return;
      }

      // Single language mode (fallback)
      await this.transcriptService.saveTranslationText(
        roomCode,
        data.targetLanguage,
        data.originalText,
        data.translatedText,
        data.contextSummary,
        false,
        sttTextId
      );

      this.io.to(roomCode).emit('translation-text', {
        targetLanguage: data.targetLanguage,
        text: data.translatedText,
        originalText: data.originalText,
        isPartial: false,
        contextSummary: data.contextSummary,
        timestamp: data.timestamp.getTime()
      });

    } catch (error) {
      console.error(`[TranslationManager][${roomCode}] Failed to save/broadcast translation:`, error);
    }
  }

  /**
   * sttIdCache 크기 제한 정리
   * 최대 크기 초과 시 오래된 항목 제거
   */
  private cleanupSttIdCache(roomCode: string): void {
    const roomCache = this.sttIdCache.get(roomCode);
    if (!roomCache) return;

    // 크기 초과 시 오래된 항목 제거
    if (roomCache.size > this.MAX_CACHE_SIZE_PER_ROOM) {
      const sorted = Array.from(roomCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = sorted.length - this.MAX_CACHE_SIZE_PER_ROOM;
      for (let i = 0; i < toRemove; i++) {
        roomCache.delete(sorted[i][0]);
      }
      console.log(`[SocketHandler][${roomCode}] Cleaned up ${toRemove} old sttIdCache entries`);
    }
  }
}
