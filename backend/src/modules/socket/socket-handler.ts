import { Server, Socket } from 'socket.io';
import { RoomService } from '../room/room-service';
import { TranscriptService } from '../room/transcript-service';
import { STTManager } from '../stt/stt-manager';

interface AudioStreamData {
  roomId: string;
  audio: string; // Base64 encoded audio
}

export class SocketHandler {
  private io: Server;
  private roomService: RoomService;
  private transcriptService: TranscriptService;
  private sttManager: STTManager;

  constructor(
    io: Server,
    roomService: RoomService,
    transcriptService: TranscriptService,
    sttManager: STTManager
  ) {
    this.io = io;
    this.roomService = roomService;
    this.transcriptService = transcriptService;
    this.sttManager = sttManager;
    this.initialize();
  }

  private initialize(): void {
    this.io.on('connection', (socket: Socket) => {
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

      // Audio stream from speaker
      socket.on('audio-stream', async (data: AudioStreamData) => {
        await this.handleAudioStream(socket, data);
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
        password,
        promptTemplate = 'general',
        customPrompt,
        targetLanguages = ['en'],
        maxListeners = 100,
        existingRoomCode
      } = data;

      let room;

      // Check if speaker wants to rejoin existing room
      if (existingRoomCode) {
        room = await this.roomService.getRoom(existingRoomCode);
        if (room && room.status !== 'ENDED') {
          // Update speaker socket ID
          room = await this.roomService.reconnectSpeaker(room.speakerId, socket.id);
        }
      }

      // Create new room if needed
      if (!room) {
        room = await this.roomService.createRoom({
          speakerName: name,
          speakerId: socket.id,
          userId,
          password,
          promptTemplate,
          customPrompt,
          targetLanguages,
          maxListeners
        });
      }

      socket.join(room.roomCode);

      // Parse target languages from room settings
      const roomTargetLanguages = room.roomSettings?.targetLanguages
        ? room.roomSettings.targetLanguages.split(',')
        : ['en'];

      // Create STT client for this room with custom prompt
      await this.sttManager.createClient(
        room.roomCode,
        // STT callback
        async (transcriptData) => {
          // Save to database
          await this.transcriptService.saveSttText(
            transcriptData.roomId,
            transcriptData.text,
            transcriptData.confidence
          );

          // Broadcast to room
          this.io.to(transcriptData.roomId).emit('stt-text', {
            text: transcriptData.text,
            timestamp: transcriptData.timestamp.getTime()
          });
        },
        // Translation callback
        async (translationData) => {
          // Save to database (with all translations)
          await this.transcriptService.saveTranslation(
            translationData.roomId,
            translationData.korean,
            translationData.english,
            translationData.batchId,
            translationData.translations ? JSON.stringify(translationData.translations) : null
          );

          // Broadcast to room (with all translations)
          this.io.to(translationData.roomId).emit('translation-batch', {
            batchId: translationData.batchId,
            korean: translationData.korean,
            english: translationData.english,
            translations: translationData.translations || { en: translationData.english },
            timestamp: translationData.timestamp.getTime()
          });
        },
        // Use custom prompt template
        room.roomSettings?.promptTemplate || 'general',
        room.roomSettings?.customPrompt,
        roomTargetLanguages
      );

      // Send room info to speaker
      socket.emit('room-created', {
        roomId: room.roomCode,
        roomSettings: room.roomSettings,
        isRejoined: !!existingRoomCode
      });

      // Send existing transcripts
      await this.sendTranscriptHistory(socket, room.roomCode);

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

      // Parse target languages from room settings
      const roomTargetLanguages = room.roomSettings?.targetLanguages
        ? room.roomSettings.targetLanguages.split(',')
        : ['en'];

      // Recreate STT client if needed
      if (!this.sttManager.hasActiveClient(roomCode)) {
        await this.sttManager.createClient(
          roomCode,
          async (transcriptData) => {
            await this.transcriptService.saveSttText(
              transcriptData.roomId,
              transcriptData.text,
              transcriptData.confidence
            );
            this.io.to(transcriptData.roomId).emit('stt-text', {
              text: transcriptData.text,
              timestamp: transcriptData.timestamp.getTime()
            });
          },
          async (translationData) => {
            await this.transcriptService.saveTranslation(
              translationData.roomId,
              translationData.korean,
              translationData.english,
              translationData.batchId,
              translationData.translations ? JSON.stringify(translationData.translations) : null
            );
            this.io.to(translationData.roomId).emit('translation-batch', {
              batchId: translationData.batchId,
              korean: translationData.korean,
              english: translationData.english,
              translations: translationData.translations || { en: translationData.english },
              timestamp: translationData.timestamp.getTime()
            });
          },
          room.roomSettings?.promptTemplate || 'general',
          room.roomSettings?.customPrompt,
          roomTargetLanguages
        );
      }

      socket.emit('room-rejoined', {
        roomId: room.roomCode,
        roomSettings: room.roomSettings
      });

      await this.sendTranscriptHistory(socket, roomCode);

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

      // Update listener count
      const listenerCount = await this.roomService.getListenerCount(roomId);
      this.io.to(roomId).emit('listener-count', { count: listenerCount });

    } catch (error) {
      console.error('[Room] Join error:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  }

  // Handle audio stream
  private async handleAudioStream(socket: Socket, data: AudioStreamData): Promise<void> {
    try {
      const { roomId, audio } = data;

      // Verify speaker
      const room = await this.roomService.getRoom(roomId);
      if (!room) {
        return;
      }

      if (room.speakerId !== socket.id) {
        return;
      }

      // Convert base64 to buffer
      const audioBuffer = Buffer.from(audio, 'base64');

      // Send to STT
      this.sttManager.sendAudio(roomId, audioBuffer);

    } catch (error) {
      console.error(`[Audio] Stream error:`, error);
      if (error instanceof Error) {
        console.error(`[Audio] Error details: ${error.message}`);
        console.error(`[Audio] Stack trace:`, error.stack);
      }
    }
  }

  // Send transcript history
  private async sendTranscriptHistory(socket: Socket, roomId: string): Promise<void> {
    try {
      // Get recent translations (which include Korean text)
      const translations = await this.transcriptService.getRecentTranslations(roomId, 30);

      // Send translations only (oldest first)
      // Each translation batch contains the combined Korean text and all translations
      translations.reverse().forEach((translation: any) => {
        // Parse translations JSON if available
        let allTranslations = { en: translation.english };
        if (translation.translations) {
          try {
            allTranslations = JSON.parse(translation.translations);
          } catch (e) {
            console.error('[History] Failed to parse translations JSON:', e);
          }
        }

        socket.emit('translation-batch', {
          batchId: translation.batchId || translation.id,
          korean: translation.korean,
          english: translation.english,
          translations: allTranslations,
          timestamp: translation.timestamp.getTime(),
          isHistory: true
        });
      });

    } catch (error) {
      console.error('[History] Error loading transcripts:', error);
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
        promptTemplate: settings.promptTemplate,
        customPrompt: settings.customPrompt,
        targetLanguages: settings.targetLanguages,
        maxListeners: settings.maxListeners,
        enableTranslation: settings.enableTranslation,
        enableAutoScroll: settings.enableAutoScroll
      });

      // Update password if provided
      if (settings.password !== undefined) {
        await this.roomService.updateRoomPassword(roomId, settings.password);
      }

      // If prompt template or target languages changed, restart STT client
      if (settings.promptTemplate || settings.customPrompt || settings.targetLanguages) {
        // Close existing client
        this.sttManager.closeClient(roomId);

        // Parse target languages
        const targetLanguages = settings.targetLanguages ||
          (updatedSettings.targetLanguages ? updatedSettings.targetLanguages.split(',') : ['en']);

        // Recreate with new settings
        await this.sttManager.createClient(
          roomId,
          async (transcriptData) => {
            await this.transcriptService.saveSttText(
              transcriptData.roomId,
              transcriptData.text,
              transcriptData.confidence
            );
            this.io.to(transcriptData.roomId).emit('stt-text', {
              text: transcriptData.text,
              timestamp: transcriptData.timestamp.getTime()
            });
          },
          async (translationData) => {
            await this.transcriptService.saveTranslation(
              translationData.roomId,
              translationData.korean,
              translationData.english,
              translationData.batchId,
              translationData.translations ? JSON.stringify(translationData.translations) : null
            );
            this.io.to(translationData.roomId).emit('translation-batch', {
              batchId: translationData.batchId,
              korean: translationData.korean,
              english: translationData.english,
              translations: translationData.translations || { en: translationData.english },
              timestamp: translationData.timestamp.getTime()
            });
          },
          settings.promptTemplate || updatedSettings.promptTemplate,
          settings.customPrompt || updatedSettings.customPrompt,
          targetLanguages
        );
      }

      // Broadcast to room
      this.io.to(roomId).emit('settings-updated', updatedSettings);

    } catch (error) {
      console.error('[Settings] Update error:', error);
      socket.emit('error', { message: 'Failed to update settings' });
    }
  }

  // Handle disconnect
  private async handleDisconnect(socket: Socket): Promise<void> {
    try {
      await this.roomService.handleDisconnect(socket.id);

      // Check if it was a speaker and clean up STT client
      // Implementation depends on your needs

    } catch (error) {
      console.error('[Disconnect] Error:', error);
    }
  }
}