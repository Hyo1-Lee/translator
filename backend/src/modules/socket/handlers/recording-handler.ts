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

    if (ctx.sttManager.hasActiveClient(roomId)) {
      return;
    }

    try {
      await ctx.setupSttCallbacks(roomId, room.roomSettings?.promptTemplate || 'general');

      await recordingStateService.startRecording(room.id);
      await sessionManager.updateHeartbeat(room.id);

    } catch (error) {
      console.error(`[Recording][${roomId}] Failed to create STT client:`, error);
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

    await recordingStateService.stopRecording(room.id);

  } catch (error) {
    console.error('[Recording] Stop error:', error);
  }
}
