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

    // Verify room and speaker
    const room = await ctx.roomService.getRoom(roomId);
    if (!room) {
      console.warn(`[Recording][${roomId}] Room not found`);
      return;
    }

    // Verify speaker using userId
    const userId = (socket as AuthenticatedSocket).userId;
    const isAuthorized = await sessionManager.validateSpeaker(room.id, userId || null);
    if (!isAuthorized) {
      console.warn(`[Recording][${roomId}] Unauthorized (not speaker)`);
      return;
    }

    // Check if STT client already exists and is active
    if (ctx.sttManager.hasActiveClient(roomId)) {
      console.log(`[Recording][${roomId}] STT client already active`);
      return;
    }

    // Create new STT client
    console.log(`[Recording][${roomId}] Creating new STT client...`);
    try {
      await ctx.sttManager.createClient(
        roomId,
        async (transcriptData) => {
          if (transcriptData.isFinal) {
            const translationManager = ctx.translationManagers.get(transcriptData.roomId);
            if (translationManager) {
              translationManager.addTranscript(
                transcriptData.text,
                true,
                transcriptData.confidence
              );
            }
          }

          ctx.io.to(transcriptData.roomId).emit('stt-text', {
            text: transcriptData.text,
            timestamp: transcriptData.timestamp.getTime(),
            isFinal: transcriptData.isFinal
          });
        },
        undefined,
        room.roomSettings?.promptTemplate || 'general'
      );

      console.log(`[Recording][${roomId}] STT client created and ready`);

      // Create TranslationManager if needed
      if (room.roomSettings?.enableTranslation && !ctx.translationManagers.has(roomId)) {
        await ctx.createTranslationManager(roomId, room.roomSettings);
      }

      // Update recording state
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

    // Verify room and speaker
    const room = await ctx.roomService.getRoom(roomId);
    if (!room) {
      console.warn(`[Recording][${roomId}] Room not found`);
      return;
    }

    // Verify speaker using userId
    const userId = (socket as AuthenticatedSocket).userId;
    const isAuthorized = await sessionManager.validateSpeaker(room.id, userId || null);
    if (!isAuthorized) {
      console.warn(`[Recording][${roomId}] Unauthorized (not speaker)`);
      return;
    }

    // Close STT client to prevent Deepgram timeout
    console.log(`[Recording][${roomId}] Closing STT client...`);
    ctx.sttManager.removeClient(roomId);
    ctx.audioChunksReceived.delete(roomId);
    console.log(`[Recording][${roomId}] STT client closed`);

    // Update recording state
    await recordingStateService.stopRecording(room.id);

  } catch (error) {
    console.error('[Recording] Stop error:', error);
  }
}
