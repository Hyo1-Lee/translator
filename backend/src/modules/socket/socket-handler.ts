import { Server, Socket } from 'socket.io';
import { RoomService } from '../room/room-service';
import { TranscriptService } from '../room/transcript-service';
import { STTManager } from '../stt/stt-manager';
import { TranslationService } from '../translation/translation-service';
import { GoogleTranslateService } from '../translation/google-translate.service';
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
  private googleTranslateService: GoogleTranslateService;
  private translationManagers: Map<string, TranslationManager> = new Map();
  private sttIdCache: Map<string, Map<string, SttIdCacheEntry>> = new Map();
  private audioChunksReceived: Map<string, number> = new Map();

  constructor(
    io: Server,
    roomService: RoomService,
    transcriptService: TranscriptService,
    sttManager: STTManager,
    translationService: TranslationService,
    googleTranslateService: GoogleTranslateService
  ) {
    this.io = io;
    this.roomService = roomService;
    this.transcriptService = transcriptService;
    this.sttManager = sttManager;
    this.translationService = translationService;
    this.googleTranslateService = googleTranslateService;
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
      googleTranslateService: this.googleTranslateService,
      translationManagers: this.translationManagers,
      sttIdCache: this.sttIdCache,
      audioChunksReceived: this.audioChunksReceived,
      createTranslationManager: this.createTranslationManager.bind(this),
      sendTranscriptHistory: this.sendTranscriptHistory.bind(this),
      sendTranslationHistory: this.sendTranslationHistory.bind(this)
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

  // Create TranslationManager for a room
  private async createTranslationManager(
    roomCode: string,
    roomSettings: any
  ): Promise<void> {
    try {
      const targetLanguages = roomSettings.targetLanguagesArray || ['en'];

      console.log(`[TranslationManager][${roomCode}] Creating TranslationManager...`);
      console.log(`[TranslationManager][${roomCode}] Source: ${roomSettings.sourceLanguage || 'ko'}`);
      console.log(`[TranslationManager][${roomCode}] Targets: ${targetLanguages.join(', ')}`);
      console.log(`[TranslationManager][${roomCode}] Preset: ${roomSettings.environmentPreset || 'general'}`);

      const translationManager = new TranslationManager({
        roomId: roomCode,
        sourceLanguage: roomSettings.sourceLanguage || 'ko',
        environmentPreset: (roomSettings.environmentPreset as EnvironmentPreset) || 'general',
        customEnvironmentDescription: roomSettings.customEnvironmentDescription,
        customGlossary: roomSettings.customGlossary,
        targetLanguages,
        enableStreaming: roomSettings.enableStreaming ?? true,
        translationService: this.translationService,
        googleTranslateService: this.googleTranslateService,
        onTranslation: async (data: TranslationData) => {
          await this.handleTranslationData(roomCode, data);
        },
        onError: (error: Error) => {
          console.error(`[TranslationManager][${roomCode}] Error:`, error);
        }
      });

      this.translationManagers.set(roomCode, translationManager);
      console.log(`[TranslationManager][${roomCode}] Created and ready`);

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

      // Check if we already saved STT text for this originalText
      const cachedEntry = roomCache.get(data.originalText);
      if (cachedEntry) {
        sttTextId = cachedEntry.id;
        console.log(`[TranslationManager][${roomCode}] Using cached STT ID: ${sttTextId} for "${data.originalText.substring(0, 50)}..."`);
      } else if (!data.sttTextId && !data.isPartial) {
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

        console.log(`[TranslationManager][${roomCode}] Saved STT text: "${data.originalText.substring(0, 50)}..." (ID: ${sttTextId})`);
      }

      // Skip saving partial translations
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

      // Save final translation to database
      await this.transcriptService.saveTranslationText(
        roomCode,
        data.targetLanguage,
        data.originalText,
        data.translatedText,
        data.contextSummary,
        false,
        sttTextId
      );

      // Broadcast via socket
      this.io.to(roomCode).emit('translation-text', {
        targetLanguage: data.targetLanguage,
        text: data.translatedText,
        originalText: data.originalText,
        isPartial: false,
        contextSummary: data.contextSummary,
        timestamp: data.timestamp.getTime()
      });

      console.log(`[TranslationManager][${roomCode}] Saved & broadcasted ${data.targetLanguage} translation`);
    } catch (error) {
      console.error(`[TranslationManager][${roomCode}] Failed to save/broadcast translation:`, error);
    }
  }
}
