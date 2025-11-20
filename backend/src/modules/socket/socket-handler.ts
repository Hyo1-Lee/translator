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

      // Audio stream from speaker (legacy Base64)
      socket.on('audio-stream', async (data: AudioStreamData) => {
        await this.handleAudioStream(socket, data);
      });

      // NEW: Direct Blob audio (Deepgram-compatible)
      socket.on('audio-blob', async (data: { roomId: string; audio: Buffer }) => {
        await this.handleAudioBlob(socket, data);
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

      // Log active STT clients for debugging
      const activeClients = this.sttManager.getActiveRoomIds();
      console.log(`[Room] 🔍 Active STT clients: [${activeClients.join(', ')}]`);

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
            // STT callback - ULTRA FAST PATH
            async (transcriptData) => {
              // Save final transcripts only
              if (transcriptData.isFinal) {
                await this.transcriptService.saveSttText(
                  transcriptData.roomId,
                  transcriptData.text,
                  transcriptData.confidence
                );
              }

              // Broadcast immediately
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
          console.log(`[Room] 📊 Active clients: [${this.sttManager.getActiveRoomIds().join(', ')}]`);
        } catch (error) {
          console.error(`[Room][${room.roomCode}] ❌ Failed to create STT client:`, error);
          socket.emit('error', { message: 'Failed to initialize STT service' });
          return;
        }
      } else {
        console.log(`[Room][${room.roomCode}] ♻️  Reusing existing STT client`);
      }

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
            if (transcriptData.isFinal) {
              await this.transcriptService.saveSttText(
                transcriptData.roomId,
                transcriptData.text,
                transcriptData.confidence
              );
            }
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

      if (count === 1 || count % 50 === 0) {
        console.log(`[Audio][${roomId}] ✅ Blob chunk #${count} (${audio.length} bytes)`);
      }

      // Check STT client
      if (!this.sttManager.hasActiveClient(roomId)) {
        if (count === 1) {
          console.error(`[Audio][${roomId}] ❌ No STT client! Active: [${this.sttManager.getActiveRoomIds().join(', ')}]`);
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

      // Log audio reception
      const count = (this.audioChunksReceived.get(roomId) || 0) + 1;
      this.audioChunksReceived.set(roomId, count);
      if (count === 1 || count % 100 === 0) {
        console.log(`[Audio][${roomId}] ✅ Received chunk #${count} (${audioBuffer.length} bytes)`);
      }

      // Check if STT client exists
      if (!this.sttManager.hasActiveClient(roomId)) {
        if (count === 1) {
          console.error(`[Audio][${roomId}] ❌ No active STT client found! Active clients: [${this.sttManager.getActiveRoomIds().join(', ')}]`);
        }
        return;
      }

      // Send to STT
      this.sttManager.sendAudio(roomId, audioBuffer);

    } catch (error) {
      console.error(`[Audio] ❌ Stream error:`, error);
      if (error instanceof Error) {
        console.error(`[Audio] Error details: ${error.message}`);
        console.error(`[Audio] Stack trace:`, error.stack);
      }
    }
  }

  // Send transcript history
  private async sendTranscriptHistory(socket: Socket, roomId: string): Promise<void> {
    try {
      // Get recent STT transcripts
      const transcripts = await this.transcriptService.getRecentSttTexts(roomId, 50);

      // Send transcripts (oldest first)
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
            if (transcriptData.isFinal) {
              await this.transcriptService.saveSttText(
                transcriptData.roomId,
                transcriptData.text,
                transcriptData.confidence
              );
            }
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

      // Check if this socket was a speaker and clean up STT client
      const speakerRoom = await this.roomService.getRoomBySpeakerId(socket.id);
      if (speakerRoom) {
        this.sttManager.removeClient(speakerRoom.roomCode);
        this.audioChunksReceived.delete(speakerRoom.roomCode);
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