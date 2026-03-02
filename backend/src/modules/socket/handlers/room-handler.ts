import { Socket } from 'socket.io';
import { HandlerContext } from './types';
import { sessionManager } from '../../../services/session-manager';
import { recordingStateService } from '../../../services/recording-state-service';

export async function handleCreateRoom(
  ctx: HandlerContext,
  socket: Socket,
  data: any
): Promise<void> {
  try {
    const {
      name = 'Speaker',
      userId,
      roomTitle,
      password,
      promptTemplate = 'general',
      customPrompt,
      maxListeners = 100,
      existingRoomCode,
      targetLanguagesArray,
      sourceLanguage,
      environmentPreset,
      customEnvironmentDescription,
      customGlossary,
      enableStreaming
    } = data;

    let room;

    // Check if speaker wants to rejoin existing room
    if (existingRoomCode) {
      const existingRoom = await ctx.roomService.getRoom(existingRoomCode);
      if (existingRoom) {
        const isEndedRoom = existingRoom.status === 'ENDED';
        console.log(`[Room] Rejoining existing room: ${existingRoomCode}${isEndedRoom ? ' (read-only, ended)' : ''}`);

        room = await ctx.roomService.reconnectSpeakerByRoomCode(existingRoomCode, socket.id);
        if (!room) {
          console.warn(`[Room] reconnectSpeakerByRoomCode failed, using existingRoom`);
          room = existingRoom;
        }

        const previousRoom = await ctx.roomService.getRoomBySpeakerId(socket.id);
        if (previousRoom && previousRoom.roomCode !== existingRoomCode) {
          const oldRoomCode = previousRoom.roomCode;
          console.log(`[Room] Cleaning up old room client: ${oldRoomCode}`);
          ctx.sttManager.removeClient(oldRoomCode);
          ctx.audioChunksReceived.delete(oldRoomCode);
          ctx.sessionService.removeSession(oldRoomCode);
          ctx.sttIdCache.delete(oldRoomCode);
        }
      }
    } else {
      const previousRoom = await ctx.roomService.getRoomBySpeakerId(socket.id);
      if (previousRoom) {
        const oldRoomCode = previousRoom.roomCode;
        console.log(`[Room] Cleaning up previous room client: ${oldRoomCode}`);
        ctx.sttManager.removeClient(oldRoomCode);
        ctx.audioChunksReceived.delete(oldRoomCode);
        ctx.sessionService.removeSession(oldRoomCode);
        ctx.sttIdCache.delete(oldRoomCode);
      }
    }

    // Create new room if needed
    if (!room) {
      room = await ctx.roomService.createRoom({
        speakerName: name,
        speakerId: socket.id,
        userId,
        roomTitle: roomTitle || null,
        password,
        promptTemplate,
        customPrompt,
        maxListeners,
        targetLanguages: targetLanguagesArray || ['en']
      });

      if (room && (sourceLanguage || environmentPreset || customEnvironmentDescription || customGlossary || enableStreaming !== undefined)) {
        await ctx.roomService.updateRoomSettings(room.roomCode, {
          sourceLanguage,
          environmentPreset,
          customEnvironmentDescription,
          customGlossary,
          enableStreaming
        });
        room = await ctx.roomService.getRoom(room.roomCode);
      }
    }

    socket.join(room.roomCode);

    // Create STT client for this room
    if (!ctx.sttManager.hasActiveClient(room.roomCode)) {
      try {
        await ctx.setupSttCallbacks(room.roomCode, room.roomSettings?.promptTemplate || 'general');
      } catch (error) {
        console.error(`[Room][${room.roomCode}] Failed to create STT client:`, error);
        socket.emit('error', { message: 'Failed to initialize STT service' });
        return;
      }
    }

    // Send room info to speaker
    socket.emit('room-created', {
      roomId: room.roomCode,
      roomStatus: room.status,
      roomSettings: room.roomSettings,
      isRejoined: !!existingRoomCode
    });

    // Send existing transcripts and translations
    await ctx.sendTranscriptHistory(socket, room.roomCode);
    await ctx.sendTranslationHistory(socket, room.roomCode);

    // Translate any untranslated historical texts
    await ctx.translateHistoricalTexts(room.roomCode);

    await sessionManager.registerSpeakerSocket(room.id, socket.id);
    await recordingStateService.syncRecordingState(room.id, socket.id);

    const listenerCount = await ctx.roomService.getListenerCount(room.roomCode);
    ctx.io.to(room.roomCode).emit('listener-count', { count: listenerCount });

  } catch (error) {
    console.error('[Room] Creation error:', error);
    socket.emit('error', { message: 'Failed to create room' });
  }
}

export async function handleRejoinRoom(
  ctx: HandlerContext,
  socket: Socket,
  data: any
): Promise<void> {
  try {
    const { roomCode, speakerId } = data;

    const room = await ctx.roomService.getRoom(roomCode);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.speakerId !== speakerId) {
      socket.emit('error', { message: 'Invalid speaker credentials' });
      return;
    }

    await ctx.roomService.reconnectSpeaker(speakerId, socket.id);
    socket.join(roomCode);

    if (!ctx.sttManager.hasActiveClient(roomCode)) {
      await ctx.setupSttCallbacks(roomCode, room.roomSettings?.promptTemplate || 'general');
    }

    socket.emit('room-rejoined', {
      roomId: room.roomCode,
      roomStatus: room.status,
      roomSettings: room.roomSettings
    });

    await sessionManager.registerSpeakerSocket(room.id, socket.id);
    await recordingStateService.syncRecordingState(room.id, socket.id);

    await ctx.sendTranscriptHistory(socket, roomCode);
    await ctx.sendTranslationHistory(socket, roomCode);

    // Translate any untranslated historical texts
    await ctx.translateHistoricalTexts(roomCode);

  } catch (error) {
    console.error('[Room] Rejoin error:', error);
    socket.emit('error', { message: 'Failed to rejoin room' });
  }
}

export async function handleJoinRoom(
  ctx: HandlerContext,
  socket: Socket,
  data: any
): Promise<void> {
  try {
    const { roomId, name = 'Guest', password } = data;

    const room = await ctx.roomService.getRoom(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const isProtected = await ctx.roomService.isPasswordProtected(roomId);

    if (isProtected) {
      if (!password) {
        socket.emit('password-required', { roomId });
        return;
      }

      const isValid = await ctx.roomService.verifyRoomPassword(roomId, password);
      if (!isValid) {
        socket.emit('error', { message: 'Incorrect password' });
        return;
      }
    }

    await ctx.roomService.addListener(roomId, socket.id, name);
    socket.join(roomId);

    socket.emit('room-joined', {
      roomId: room.roomCode,
      speakerName: room.speakerName,
      roomSettings: room.roomSettings
    });

    await ctx.sendTranscriptHistory(socket, roomId);
    await ctx.sendTranslationHistory(socket, roomId);

    // Translate any untranslated historical texts
    await ctx.translateHistoricalTexts(roomId);

    const listenerCount = await ctx.roomService.getListenerCount(roomId);
    ctx.io.to(roomId).emit('listener-count', { count: listenerCount });

  } catch (error) {
    console.error('[Room] Join error:', error);
    socket.emit('error', { message: 'Failed to join room' });
  }
}

export async function handleDisconnect(
  ctx: HandlerContext,
  socket: Socket
): Promise<void> {
  try {
    const rooms = Array.from(socket.rooms).filter(room => room !== socket.id);

    const speakerRoom = await ctx.roomService.getRoomBySpeakerId(socket.id);
    if (speakerRoom) {
      ctx.sttManager.removeClient(speakerRoom.roomCode);
      ctx.audioChunksReceived.delete(speakerRoom.roomCode);
      ctx.sessionService.removeSession(speakerRoom.roomCode);
      ctx.sttIdCache.delete(speakerRoom.roomCode);
      await sessionManager.unregisterSpeakerSocket(speakerRoom.id, socket.id);
    } else {
      await ctx.roomService.removeListener(socket.id);
    }

    await ctx.roomService.handleDisconnect(socket.id);

    for (const roomId of rooms) {
      const listenerCount = await ctx.roomService.getListenerCount(roomId);
      ctx.io.to(roomId).emit('listener-count', { count: listenerCount });
    }

  } catch (error) {
    console.error('[Disconnect] Error:', error);
  }
}
