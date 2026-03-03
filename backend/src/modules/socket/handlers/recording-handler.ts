import { Socket } from 'socket.io';
import { HandlerContext } from './types';
import { AuthenticatedSocket } from '../../../middleware/socket-auth';
import { sessionManager } from '../../../services/session-manager';
import { recordingStateService } from '../../../services/recording-state-service';

export async function handleStartRecording(
  ctx: HandlerContext,
  socket: Socket,
  data: { roomId: string }
): Promise<void> {
  try {
    const { roomId } = data;

    if (!roomId) {
      console.error('[Recording] No roomId provided');
      return;
    }

    const room = await ctx.roomService.getRoom(roomId);
    if (!room) {
      console.warn(`[Recording][${roomId}] Room not found`);
      return;
    }

    const userId = (socket as AuthenticatedSocket).userId;
    const isAuthorized = await sessionManager.validateSpeaker(room.id, userId || null);
    if (!isAuthorized) {
      console.warn(`[Recording][${roomId}] Unauthorized (not speaker)`);
      return;
    }

    // Remove existing STT client if any (prevent timeout issues)
    if (ctx.sttManager.hasActiveClient(roomId)) {
      ctx.sttManager.removeClient(roomId);
    }
    // Clear stale translation state from previous session
    ctx.cleanupTranslationState(roomId);

    try {
      await ctx.setupSttCallbacks(roomId, room.roomSettings?.promptTemplate || 'general');

      await recordingStateService.startRecording(room.id);
      await sessionManager.updateHeartbeat(room.id);

      // Notify client that STT is ready to receive audio
      socket.emit('recording-ready', { roomId });

    } catch (error) {
      console.error(`[Recording][${roomId}] Failed to create STT client:`, error);
      socket.emit('recording-error', { message: 'STT 서비스 초기화 실패' });
    }

  } catch (error) {
    console.error('[Recording] Start error:', error);
  }
}

export async function handleStopRecording(
  ctx: HandlerContext,
  socket: Socket,
  data: { roomId: string }
): Promise<void> {
  try {
    const { roomId } = data;

    if (!roomId) {
      console.error('[Recording] No roomId provided');
      return;
    }

    const room = await ctx.roomService.getRoom(roomId);
    if (!room) {
      console.warn(`[Recording][${roomId}] Room not found`);
      return;
    }

    const userId = (socket as AuthenticatedSocket).userId;
    const isAuthorized = await sessionManager.validateSpeaker(room.id, userId || null);
    if (!isAuthorized) {
      console.warn(`[Recording][${roomId}] Unauthorized (not speaker)`);
      return;
    }

    ctx.sttManager.removeClient(roomId);
    ctx.audioChunksReceived.delete(roomId);
    ctx.cleanupTranslationState(roomId);

    await recordingStateService.stopRecording(room.id);

  } catch (error) {
    console.error('[Recording] Stop error:', error);
  }
}
