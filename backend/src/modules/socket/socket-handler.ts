import { Server, Socket } from 'socket.io';
import { RoomService } from '../room/room-service';
import { TranscriptService } from '../room/transcript-service';
import { STTManager } from '../stt/stt-manager';
import { TranslationService } from '../translation/translation-service';
import { GoogleTranslateService } from '../translation/google-translate.service';
import { TranslationManager, TranslationData } from '../translation/translation-manager';
import { EnvironmentPreset } from '../translation/presets';
import { sessionManager } from '../../services/session-manager';
import { recordingStateService } from '../../services/recording-state-service';
import { AuthenticatedSocket, attachUserIdToSocket } from '../../middleware/socket-auth';

interface AudioStreamData {
  roomId: string;
  audio: string; // Base64 encoded audio
}

export class SocketHandler {
  private io: Server;
  private roomService: RoomService;
  private transcriptService: TranscriptService;
  private sttManager: STTManager;
  private translationService: TranslationService;
  private googleTranslateService: GoogleTranslateService;
  private translationManagers: Map<string, TranslationManager> = new Map();
  // Cache STT IDs for recent translations (to link multi-language translations to same STT text)
  // Key: roomCode, Value: Map of originalText -> { sttTextId, timestamp }
  private sttIdCache: Map<string, Map<string, { id: string; timestamp: number }>> = new Map();

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
    // Initialize recording state service with Socket.IO instance
    recordingStateService.setSocketIO(io);
  }

  private initialize(): void {
    this.io.on('connection', (socket: Socket) => {
      // Attach userId for authentication (Phase 1)
      attachUserIdToSocket(socket as AuthenticatedSocket);
      // Create or rejoin room (Speaker)
      socket.on('create-room', async (data) => {
        await this.handleCreateRoom(socket, data);
      });

      // Rejoin existing room (Speaker)
      socket.on('rejoin-room', async (data) => {
        await this.handleRejoinRoom(socket, data);
      });

      // Join room (Listener)
      socket.on('join-room', async (data) => {
        await this.handleJoinRoom(socket, data);
      });

      // Audio stream from speaker (legacy Base64)
      socket.on('audio-stream', async (data: AudioStreamData) => {
        await this.handleAudioStream(socket, data);
      });

      // NEW: Direct Blob audio (Deepgram-compatible)
      socket.on('audio-blob', async (data: { roomId: string; audio: Buffer }) => {
        await this.handleAudioBlob(socket, data);
      });

      // Start recording - create/reconnect STT client
      socket.on('start-recording', async (data: { roomId: string }) => {
        await this.handleStartRecording(socket, data);
      });

      // Stop recording - close STT client to prevent timeout
      socket.on('stop-recording', async (data: { roomId: string }) => {
        await this.handleStopRecording(socket, data);
      });

      // Request transcript history
      socket.on('request-history', async (data) => {
        await this.sendTranscriptHistory(socket, data.roomId);
      });

      // Update room settings
      socket.on('update-settings', async (data) => {
        await this.handleUpdateSettings(socket, data);
      });

      // Handle disconnect
      socket.on('disconnect', async () => {
        await this.handleDisconnect(socket);
      });
    });
  }

  // Create new room or rejoin existing
  private async handleCreateRoom(socket: Socket, data: any): Promise<void> {
    try {
      const {
        name = 'Speaker',
        userId,
        roomTitle,
        password,
        promptTemplate = 'general',
        customPrompt,
        maxListeners = 100,
        existingRoomCode
      } = data;

      let room;

      // Check if speaker wants to rejoin existing room
      if (existingRoomCode) {
        const existingRoom = await this.roomService.getRoom(existingRoomCode);
        if (existingRoom && existingRoom.status !== 'ENDED') {
          console.log(`[Room] ♻️  Rejoining existing room: ${existingRoomCode}`);

          // Update speaker socket ID
          room = await this.roomService.reconnectSpeaker(existingRoom.speakerId, socket.id);
          if (!room) {
            // If reconnect failed, use existing room
            room = existingRoom;
          }

          // IMPORTANT: Only clean up OLD client if it exists and is DIFFERENT from current room
          const previousRoom = await this.roomService.getRoomBySpeakerId(socket.id);
          if (previousRoom && previousRoom.roomCode !== existingRoomCode) {
            console.log(`[Room] 🧹 Cleaning up old room client: ${previousRoom.roomCode}`);
            this.sttManager.removeClient(previousRoom.roomCode);
            this.audioChunksReceived.delete(previousRoom.roomCode);
          }
        }
      } else {
        // New room - clean up any previous room client
        const previousRoom = await this.roomService.getRoomBySpeakerId(socket.id);
        if (previousRoom) {
          console.log(`[Room] 🧹 Cleaning up previous room client: ${previousRoom.roomCode}`);
          this.sttManager.removeClient(previousRoom.roomCode);
          this.audioChunksReceived.delete(previousRoom.roomCode);
        }
      }

      // Create new room if needed
      if (!room) {
        room = await this.roomService.createRoom({
          speakerName: name,
          speakerId: socket.id,
          userId,
          roomTitle: roomTitle || null,
          password,
          promptTemplate,
          customPrompt,
          maxListeners
        });
      }

      socket.join(room.roomCode);

      // Create STT client for this room - ONLY if not already exists
      if (!this.sttManager.hasActiveClient(room.roomCode)) {
        console.log(`[Room][${room.roomCode}] 🔨 Creating new STT client...`);
        try {
          await this.sttManager.createClient(
            room.roomCode,
            // STT callback - Only for translation trigger
            async (transcriptData) => {
              // Final transcripts: trigger translation (no DB save here)
              if (transcriptData.isFinal) {
                const translationManager = this.translationManagers.get(transcriptData.roomId);
                if (translationManager) {
                  // TranslationManager will save both STT text and translation
                  translationManager.addTranscript(
                    transcriptData.text,
                    true,
                    transcriptData.confidence
                  );
                }
              }

              // Broadcast for real-time display (optional - can be disabled)
              this.io.to(transcriptData.roomId).emit('stt-text', {
                text: transcriptData.text,
                timestamp: transcriptData.timestamp.getTime(),
                isFinal: transcriptData.isFinal
              });
            },
            undefined, // No translation
            room.roomSettings?.promptTemplate || 'general'
          );

          console.log(`[Room][${room.roomCode}] ✅ STT client created and active`);
        } catch (error) {
          console.error(`[Room][${room.roomCode}] ❌ Failed to create STT client:`, error);
          socket.emit('error', { message: 'Failed to initialize STT service' });
          return;
        }
      } else {
        console.log(`[Room][${room.roomCode}] ♻️  Reusing existing STT client`);
      }

      // Create TranslationManager if translation is enabled
      if (room.roomSettings?.enableTranslation) {
        await this.createTranslationManager(room.roomCode, room.roomSettings);
      }

      // Send room info to speaker
      socket.emit('room-created', {
        roomId: room.roomCode,
        roomSettings: room.roomSettings,
        isRejoined: !!existingRoomCode
      });

      // Send existing transcripts and translations
      await this.sendTranscriptHistory(socket, room.roomCode);
      if (room.roomSettings?.enableTranslation) {
        await this.sendTranslationHistory(socket, room.roomCode);
      }
      // Register speaker socket for multi-device support (Phase 1)
      await sessionManager.registerSpeakerSocket(room.id, socket.id);

      // Sync current recording state to this speaker
      await recordingStateService.syncRecordingState(room.id, socket.id);


      // Update listener count
      const listenerCount = await this.roomService.getListenerCount(room.roomCode);
      this.io.to(room.roomCode).emit('listener-count', { count: listenerCount });

    } catch (error) {
      console.error('[Room] Creation error:', error);
      socket.emit('error', { message: 'Failed to create room' });
    }
  }

  // Rejoin existing room as speaker
  private async handleRejoinRoom(socket: Socket, data: any): Promise<void> {
    try {
      const { roomCode, speakerId } = data;

      const room = await this.roomService.getRoom(roomCode);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Verify speaker
      if (room.speakerId !== speakerId) {
        socket.emit('error', { message: 'Invalid speaker credentials' });
        return;
      }

      // Update socket ID
      await this.roomService.reconnectSpeaker(speakerId, socket.id);
      socket.join(roomCode);

      // Recreate STT client if needed
      if (!this.sttManager.hasActiveClient(roomCode)) {
        await this.sttManager.createClient(
          roomCode,
          async (transcriptData) => {
            // Final transcripts: trigger translation (no DB save here)
            if (transcriptData.isFinal) {
              const translationManager = this.translationManagers.get(transcriptData.roomId);
              if (translationManager) {
                // TranslationManager will save both STT text and translation
                translationManager.addTranscript(
                  transcriptData.text,
                  true,
                  transcriptData.confidence
                );
              }
            }

            // Broadcast for real-time display (optional - can be disabled)
            this.io.to(transcriptData.roomId).emit('stt-text', {
              text: transcriptData.text,
              timestamp: transcriptData.timestamp.getTime(),
              isFinal: transcriptData.isFinal
            });
          },
          undefined, // No translation
          room.roomSettings?.promptTemplate || 'general'
        );
      }

      // Recreate TranslationManager if needed
      if (room.roomSettings?.enableTranslation && !this.translationManagers.has(roomCode)) {
        await this.createTranslationManager(roomCode, room.roomSettings);
      }

      socket.emit('room-rejoined', {
        roomId: room.roomCode,
        roomSettings: room.roomSettings
      });
      // Register speaker socket for multi-device support (Phase 1)
      await sessionManager.registerSpeakerSocket(room.id, socket.id);

      // Sync current recording state to this speaker
      await recordingStateService.syncRecordingState(room.id, socket.id);


      await this.sendTranscriptHistory(socket, roomCode);
      if (room.roomSettings?.enableTranslation) {
        await this.sendTranslationHistory(socket, roomCode);
      }

    } catch (error) {
      console.error('[Room] Rejoin error:', error);
      socket.emit('error', { message: 'Failed to rejoin room' });
    }
  }

  // Join room as listener
  private async handleJoinRoom(socket: Socket, data: any): Promise<void> {
    try {
      const { roomId, name = 'Guest', password } = data;

      const room = await this.roomService.getRoom(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Check if room is password protected
      const isProtected = await this.roomService.isPasswordProtected(roomId);

      if (isProtected) {
        if (!password) {
          socket.emit('password-required', { roomId });
          return;
        }

        // Verify password
        const isValid = await this.roomService.verifyRoomPassword(roomId, password);
        if (!isValid) {
          socket.emit('error', { message: 'Incorrect password' });
          return;
        }
      }

      await this.roomService.addListener(roomId, socket.id, name);
      socket.join(roomId);

      socket.emit('room-joined', {
        roomId: room.roomCode,
        speakerName: room.speakerName,
        roomSettings: room.roomSettings
      });

      // Send transcript history
      await this.sendTranscriptHistory(socket, roomId);
      if (room.roomSettings?.enableTranslation) {
        await this.sendTranslationHistory(socket, roomId);
      }

      // Update listener count
      const listenerCount = await this.roomService.getListenerCount(roomId);
      this.io.to(roomId).emit('listener-count', { count: listenerCount });

    } catch (error) {
      console.error('[Room] Join error:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  }

  // Handle audio stream
  private audioChunksReceived: Map<string, number> = new Map();

  // NEW: Handle direct Blob audio (Deepgram-compatible, NO Base64!)
  private async handleAudioBlob(socket: Socket, data: { roomId: string; audio: Buffer }): Promise<void> {
    try {
      const { roomId, audio } = data;

      if (!roomId) {
        console.error(`[Audio] ❌ No roomId in blob audio`);
        return;
      }

      if (!audio || audio.length === 0) {
        console.error(`[Audio][${roomId}] ❌ Empty audio blob`);
        return;
      }

      // Verify speaker
      const room = await this.roomService.getRoom(roomId);
      if (!room) {
        console.warn(`[Audio][${roomId}] ❌ Room not found`);
        return;
      }

      if (room.speakerId !== socket.id) {
        console.warn(`[Audio][${roomId}] ❌ Unauthorized (expected: ${room.speakerId}, got: ${socket.id})`);
        return;
      }

      // Count chunks
      const count = (this.audioChunksReceived.get(roomId) || 0) + 1;
      this.audioChunksReceived.set(roomId, count);

      if (count === 1) {
        console.log(`[Audio][${roomId}] ✅ First blob chunk (${audio.length} bytes)`);
      }

      // Check STT client
      if (!this.sttManager.hasActiveClient(roomId)) {
        if (count === 1) {
          console.error(`[Audio][${roomId}] ❌ No STT client`);
        }
        return;
      }

      // Send directly to Deepgram (audio is already in correct format!)
      this.sttManager.sendAudio(roomId, audio);

    } catch (error) {
      console.error(`[Audio] ❌ Blob error:`, error);
    }
  }

  private async handleAudioStream(socket: Socket, data: AudioStreamData): Promise<void> {
    try {
      const { roomId, audio } = data;

      if (!roomId) {
        console.error(`[Audio] ❌ No roomId provided in audio stream`);
        return;
      }

      if (!audio) {
        console.error(`[Audio][${roomId}] ❌ No audio data provided`);
        return;
      }

      // Verify speaker
      const room = await this.roomService.getRoom(roomId);
      if (!room) {
        console.warn(`[Audio][${roomId}] ❌ Room not found`);
        return;
      }

      if (room.speakerId !== socket.id) {
        console.warn(`[Audio][${roomId}] ❌ Unauthorized audio stream attempt (expected: ${room.speakerId}, got: ${socket.id})`);
        return;
      }

      // Convert base64 to buffer
      const audioBuffer = Buffer.from(audio, 'base64');

      // Validate audio buffer
      if (audioBuffer.length === 0) {
        console.warn(`[Audio][${roomId}] ⚠️  Empty audio buffer received`);
        return;
      }

      // Log first chunk with detailed info
      const count = (this.audioChunksReceived.get(roomId) || 0) + 1;
      this.audioChunksReceived.set(roomId, count);

      if (count === 1) {
        console.log(`[Audio][${roomId}] ✅ First chunk received:`);
        console.log(`  - Buffer size: ${audioBuffer.length} bytes`);
        console.log(`  - Base64 size: ${audio.length} chars`);
        console.log(`  - Expected format: 16-bit PCM, 16kHz mono`);
        console.log(`  - Sample count: ~${audioBuffer.length / 2} samples`);
        console.log(`  - Duration: ~${(audioBuffer.length / 2 / 16000).toFixed(3)}s`);
      } else if (count === 10) {
        console.log(`[Audio][${roomId}] ✅ 10 chunks received and processing`);
      }

      // Check if STT client exists
      if (!this.sttManager.hasActiveClient(roomId)) {
        if (count === 1) {
          console.error(`[Audio][${roomId}] ❌ No active STT client - audio will be dropped`);
        }
        return;
      }

      // Send to STT
      this.sttManager.sendAudio(roomId, audioBuffer);

    } catch (error) {
      console.error(`[Audio] ❌ Stream error:`, error);
      console.error(`[Audio] ❌ Stack:`, error instanceof Error ? error.stack : 'N/A');
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

  // Send translation history
  private async sendTranslationHistory(socket: Socket, roomId: string): Promise<void> {
    try {
      // Get all translation texts grouped by language
      const translationsByLanguage = await this.transcriptService.getAllTranslationTexts(roomId);

      // Send each language's translations
      for (const [language, translations] of Object.entries(translationsByLanguage)) {
        translations.forEach((translation: any) => {
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

      console.log(`[History][${roomId}] 📜 Sent translation history for ${Object.keys(translationsByLanguage).length} languages`);

    } catch (error) {
      console.error('[History] Error loading translations:', error);
    }
  }

  // Update room settings
  private async handleUpdateSettings(socket: Socket, data: any): Promise<void> {
    try {
      const { roomId, settings } = data;

      // Verify speaker
      const room = await this.roomService.getRoom(roomId);
      if (!room || room.speakerId !== socket.id) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      // Update settings in database
      const updatedSettings = await this.roomService.updateRoomSettings(roomId, {
        roomTitle: settings.roomTitle,
        promptTemplate: settings.promptTemplate,
        customPrompt: settings.customPrompt,
        maxListeners: settings.maxListeners,
        enableAutoScroll: settings.enableAutoScroll
      });

      // Update password if provided
      if (settings.password !== undefined) {
        await this.roomService.updateRoomPassword(roomId, settings.password);
      }

      // If prompt template changed, restart STT client
      if (settings.promptTemplate) {
        this.sttManager.removeClient(roomId);

        await this.sttManager.createClient(
          roomId,
          async (transcriptData) => {
            // Final transcripts: trigger translation (no DB save here)
            if (transcriptData.isFinal) {
              const translationManager = this.translationManagers.get(transcriptData.roomId);
              if (translationManager) {
                // TranslationManager will save both STT text and translation
                translationManager.addTranscript(
                  transcriptData.text,
                  true,
                  transcriptData.confidence
                );
              }
            }

            // Broadcast for real-time display (optional - can be disabled)
            this.io.to(transcriptData.roomId).emit('stt-text', {
              text: transcriptData.text,
              timestamp: transcriptData.timestamp.getTime(),
              isFinal: transcriptData.isFinal
            });
          },
          undefined, // No translation
          settings.promptTemplate || updatedSettings.promptTemplate
        );
      }

      // If translation settings changed, restart TranslationManager
      const translationSettingsChanged =
        settings.enableTranslation !== undefined ||
        settings.sourceLanguage !== undefined ||
        settings.targetLanguagesArray !== undefined ||
        settings.environmentPreset !== undefined ||
        settings.customEnvironmentDescription !== undefined ||
        settings.customGlossary !== undefined ||
        settings.enableStreaming !== undefined;

      if (translationSettingsChanged) {
        // Clean up existing TranslationManager
        const existingManager = this.translationManagers.get(roomId);
        if (existingManager) {
          existingManager.cleanup();
          this.translationManagers.delete(roomId);
          console.log(`[Settings][${roomId}] 🧹 Cleaned up old TranslationManager`);
        }

        // Recreate if translation is enabled
        if (updatedSettings.enableTranslation) {
          await this.createTranslationManager(roomId, updatedSettings);
        }
      }

      // Broadcast to room
      this.io.to(roomId).emit('settings-updated', updatedSettings);

    } catch (error) {
      console.error('[Settings] Update error:', error);
      socket.emit('error', { message: 'Failed to update settings' });
    }
  }

  // Handle start recording
  private async handleStartRecording(socket: Socket, data: { roomId: string }): Promise<void> {
    try {
      const { roomId } = data;

      if (!roomId) {
        console.error('[Recording] ❌ No roomId provided');
        return;
      }

      // Verify room and speaker
      const room = await this.roomService.getRoom(roomId);
      if (!room) {
        console.warn(`[Recording][${roomId}] ❌ Room not found`);
        return;
      }

      // Verify speaker using userId (Phase 1)
      const userId = (socket as AuthenticatedSocket).userId;
      const isAuthorized = await sessionManager.validateSpeaker(room.id, userId || null);
      if (!isAuthorized) {
        console.warn(`[Recording][${roomId}] ❌ Unauthorized (not speaker)`);
        return;
      }

      // Check if STT client already exists and is active
      if (this.sttManager.hasActiveClient(roomId)) {
        console.log(`[Recording][${roomId}] ✅ STT client already active`);
        return;
      }

      // Create new STT client
      console.log(`[Recording][${roomId}] 🔨 Creating new STT client...`);
      try {
        await this.sttManager.createClient(
          roomId,
          // STT callback - Only for translation trigger
          async (transcriptData) => {
            // Final transcripts: trigger translation (no DB save here)
            if (transcriptData.isFinal) {
              const translationManager = this.translationManagers.get(transcriptData.roomId);
              if (translationManager) {
                // TranslationManager will save both STT text and translation
                translationManager.addTranscript(
                  transcriptData.text,
                  true,
                  transcriptData.confidence
                );
              }
            }

            // Broadcast for real-time display (optional - can be disabled)
            this.io.to(transcriptData.roomId).emit('stt-text', {
              text: transcriptData.text,
              timestamp: transcriptData.timestamp.getTime(),
              isFinal: transcriptData.isFinal
            });
          },
          undefined, // No translation
          room.roomSettings?.promptTemplate || 'general'
        );

        console.log(`[Recording][${roomId}] ✅ STT client created and ready`);

        // Create TranslationManager if needed
        if (room.roomSettings?.enableTranslation && !this.translationManagers.has(roomId)) {
          await this.createTranslationManager(roomId, room.roomSettings);
        }
      } catch (error) {
      // Update recording state (Phase 1)
      await recordingStateService.startRecording(room.id);
      await sessionManager.updateHeartbeat(room.id);

        console.error(`[Recording][${roomId}] ❌ Failed to create STT client:`, error);
      }

    } catch (error) {
      console.error('[Recording] Start error:', error);
    }
  }

  // Handle stop recording
  private async handleStopRecording(socket: Socket, data: { roomId: string }): Promise<void> {
    try {
      const { roomId } = data;

      if (!roomId) {
        console.error('[Recording] ❌ No roomId provided');
        return;
      }

      // Verify room and speaker
      const room = await this.roomService.getRoom(roomId);
      if (!room) {
        console.warn(`[Recording][${roomId}] ❌ Room not found`);
      // Verify speaker using userId (Phase 1)
      const userId = (socket as AuthenticatedSocket).userId;
      const isAuthorized = await sessionManager.validateSpeaker(room.id, userId || null);
      if (!isAuthorized) {
        console.warn(`[Recording][${roomId}] ❌ Unauthorized (not speaker)`);
        return;
      }
        console.warn(`[Recording][${roomId}] ❌ Unauthorized (not speaker)`);
        return;
      }

      // Close STT client to prevent Deepgram timeout
      console.log(`[Recording][${roomId}] 🔌 Closing STT client...`);
      this.sttManager.removeClient(roomId);
      this.audioChunksReceived.delete(roomId);
      console.log(`[Recording][${roomId}] ✅ STT client closed`);
      // Update recording state (Phase 1)
      await recordingStateService.stopRecording(room.id);


    } catch (error) {
      console.error('[Recording] Stop error:', error);
    }
  }

  // Create TranslationManager for a room
  private async createTranslationManager(
    roomCode: string,
    roomSettings: any
  ): Promise<void> {
    try {
      // Parse target languages
      const targetLanguages = roomSettings.targetLanguagesArray || ['en'];

      console.log(`[TranslationManager][${roomCode}] 🔨 Creating TranslationManager...`);
      console.log(`[TranslationManager][${roomCode}] Source: ${roomSettings.sourceLanguage || 'ko'}`);
      console.log(`[TranslationManager][${roomCode}] Targets: ${targetLanguages.join(', ')}`);
      console.log(`[TranslationManager][${roomCode}] Preset: ${roomSettings.environmentPreset || 'general'}`);

      // Create TranslationManager
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
              console.log(`[TranslationManager][${roomCode}] 🔗 Using cached STT ID: ${sttTextId} for "${data.originalText.substring(0, 50)}..."`);
            } else if (!data.sttTextId && !data.isPartial) {
              // Save STT text on first translation only (sttTextId === undefined)
              const savedStt = await this.transcriptService.saveSttText(
                roomCode,
                data.originalText,
                data.confidence
              );
              sttTextId = savedStt?.id;

              // Cache the STT ID for this originalText
              if (sttTextId) {
                roomCache.set(data.originalText, { id: sttTextId, timestamp: now });
              }

              console.log(`[TranslationManager][${roomCode}] 💾 Saved STT text: "${data.originalText.substring(0, 50)}..." (ID: ${sttTextId})`);
            }

            // Skip saving partial translations
            if (data.isPartial) {
              // Only broadcast partial translations, don't save to DB
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
              false,  // isPartial = false
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

            console.log(`[TranslationManager][${roomCode}] ✅ Saved & broadcasted ${data.targetLanguage} translation`);
          } catch (error) {
            console.error(`[TranslationManager][${roomCode}] ❌ Failed to save/broadcast translation:`, error);
          }
        },
        onError: (error: Error) => {
          console.error(`[TranslationManager][${roomCode}] ❌ Error:`, error);
        }
      });

      this.translationManagers.set(roomCode, translationManager);
      console.log(`[TranslationManager][${roomCode}] ✅ Created and ready`);

    } catch (error) {
      console.error(`[TranslationManager][${roomCode}] ❌ Failed to create:`, error);
      throw error;
    }
  }

  // Handle disconnect
  private async handleDisconnect(socket: Socket): Promise<void> {
    try {
      // Get rooms this socket was part of before disconnect
      const rooms = Array.from(socket.rooms).filter(room => room !== socket.id);

      // Check if this socket was a speaker and clean up STT client + TranslationManager
      const speakerRoom = await this.roomService.getRoomBySpeakerId(socket.id);
      if (speakerRoom) {
        this.sttManager.removeClient(speakerRoom.roomCode);
        this.audioChunksReceived.delete(speakerRoom.roomCode);

        // Clean up TranslationManager
        const translationManager = this.translationManagers.get(speakerRoom.roomCode);
        if (translationManager) {
          translationManager.cleanup();
          this.translationManagers.delete(speakerRoom.roomCode);
          console.log(`[Disconnect][${speakerRoom.roomCode}] 🧹 TranslationManager cleaned up`);
        }

        // Clean up STT ID cache
        this.sttIdCache.delete(speakerRoom.roomCode);
        console.log(`[Disconnect][${speakerRoom.roomCode}] 🧹 STT ID cache cleaned up`);

        // Unregister speaker socket (Phase 1)
        await sessionManager.unregisterSpeakerSocket(speakerRoom.id, socket.id);
        console.log(`[Disconnect][${speakerRoom.roomCode}] 🧹 Speaker socket unregistered`);
      }

      await this.roomService.handleDisconnect(socket.id);

      // Update listener count for affected rooms
      for (const roomId of rooms) {
        const listenerCount = await this.roomService.getListenerCount(roomId);
        this.io.to(roomId).emit('listener-count', { count: listenerCount });
      }

    } catch (error) {
      console.error('[Disconnect] Error:', error);
    }
  }
}