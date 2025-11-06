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
        const existingRoom = await this.roomService.getRoom(existingRoomCode);
        if (existingRoom && existingRoom.status !== 'ENDED') {
          // Update speaker socket ID
          room = await this.roomService.reconnectSpeaker(existingRoom.speakerId, socket.id);
          if (!room) {
            // If reconnect failed, use existing room
            room = existingRoom;
          }
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
          // Save to database
          await this.transcriptService.saveTranslation(
            translationData.roomId,
            translationData.korean,
            translationData.english,
            translationData.batchId
          );

          // Broadcast to room
          this.io.to(translationData.roomId).emit('translation-batch', {
            batchId: translationData.batchId,
            korean: translationData.korean,
            english: translationData.english,
            timestamp: translationData.timestamp.getTime()
          });
        },
        // Use custom prompt template
        room.roomSettings?.promptTemplate || 'general',
        room.roomSettings?.customPrompt
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
              translationData.batchId
            );
            this.io.to(translationData.roomId).emit('translation-batch', {
              batchId: translationData.batchId,
              korean: translationData.korean,
              english: translationData.english,
              timestamp: translationData.timestamp.getTime()
            });
          }
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
  private audioChunksReceived: Map<string, number> = new Map();

  private async handleAudioStream(socket: Socket, data: AudioStreamData): Promise<void> {
    try {
      const { roomId, audio } = data;

      // Verify speaker
      const room = await this.roomService.getRoom(roomId);
      if (!room) {
        console.warn(`[Audio] Room not found: ${roomId}`);
        return;
      }

      if (room.speakerId !== socket.id) {
        console.warn(`[Audio] Unauthorized audio stream attempt for room ${roomId}`);
        return;
      }

      // Convert base64 to buffer
      const audioBuffer = Buffer.from(audio, 'base64');

      // Log audio reception
      const count = (this.audioChunksReceived.get(roomId) || 0) + 1;
      this.audioChunksReceived.set(roomId, count);
      if (count === 1 || count % 100 === 0) {
        console.log(`[Audio][${roomId}] Received ${count} audio chunks (${audioBuffer.length} bytes)`);
      }

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
      // Each translation batch contains the combined Korean text and English translation
      translations.reverse().forEach((translation: any) => {
        // Handle null or invalid timestamps
        let timestampValue: number;
        if (translation.timestamp && translation.timestamp instanceof Date) {
          timestampValue = translation.timestamp.getTime();
        } else if (translation.timestamp) {
          // Try to parse if it's a string or number
          timestampValue = new Date(translation.timestamp).getTime();
        } else if (translation.createdAt) {
          // Fallback to createdAt
          timestampValue = new Date(translation.createdAt).getTime();
        } else {
          // Last resort: use current time
          timestampValue = Date.now();
        }

        socket.emit('translation-batch', {
          batchId: translation.batchId || translation.id,
          korean: translation.korean,
          english: translation.english,
          timestamp: timestampValue,
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

      // If prompt template changed, restart STT client with new template
      if (settings.promptTemplate || settings.customPrompt) {
        // Close existing client
        this.sttManager.removeClient(roomId);

        // Recreate with new prompt
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
              translationData.batchId
            );
            this.io.to(translationData.roomId).emit('translation-batch', {
              batchId: translationData.batchId,
              korean: translationData.korean,
              english: translationData.english,
              timestamp: translationData.timestamp.getTime()
            });
          },
          settings.promptTemplate || updatedSettings.promptTemplate,
          settings.customPrompt || updatedSettings.customPrompt
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
      // Get rooms this socket was part of before disconnect
      const rooms = Array.from(socket.rooms).filter(room => room !== socket.id);

      await this.roomService.handleDisconnect(socket.id);

      // Update listener count for affected rooms
      for (const roomId of rooms) {
        const listenerCount = await this.roomService.getListenerCount(roomId);
        this.io.to(roomId).emit('listener-count', { count: listenerCount });
        console.log(`[Disconnect] Updated listener count for room ${roomId}: ${listenerCount}`);
      }

      // Check if it was a speaker and clean up STT client
      // Implementation depends on your needs

    } catch (error) {
      console.error('[Disconnect] Error:', error);
    }
  }
}