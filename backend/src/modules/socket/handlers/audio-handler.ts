import { Socket } from 'socket.io';
import { HandlerContext, AudioStreamData, AudioBlobData } from './types';

export async function handleAudioBlob(
  ctx: HandlerContext,
  socket: Socket,
  data: AudioBlobData
): Promise<void> {
  try {
    const { roomId, audio } = data;

    if (!roomId) {
      console.error(`[Audio] No roomId in blob audio`);
      return;
    }

    if (!audio || audio.length === 0) {
      console.error(`[Audio][${roomId}] Empty audio blob`);
      return;
    }

    // Verify speaker
    const room = await ctx.roomService.getRoom(roomId);
    if (!room) {
      console.warn(`[Audio][${roomId}] Room not found`);
      return;
    }

    if (room.speakerId !== socket.id) {
      console.warn(`[Audio][${roomId}] Unauthorized (expected: ${room.speakerId}, got: ${socket.id})`);
      return;
    }

    // Count chunks
    const count = (ctx.audioChunksReceived.get(roomId) || 0) + 1;
    ctx.audioChunksReceived.set(roomId, count);

    if (count === 1) {
      console.log(`[Audio][${roomId}] First blob chunk (${audio.length} bytes)`);
    }

    // Check STT client
    if (!ctx.sttManager.hasActiveClient(roomId)) {
      if (count === 1) {
        console.error(`[Audio][${roomId}] No STT client`);
      }
      return;
    }

    // Send directly to Deepgram
    ctx.sttManager.sendAudio(roomId, audio);

  } catch (error) {
    console.error(`[Audio] Blob error:`, error);
  }
}

export async function handleAudioStream(
  ctx: HandlerContext,
  socket: Socket,
  data: AudioStreamData
): Promise<void> {
  try {
    const { roomId, audio } = data;

    if (!roomId) {
      console.error(`[Audio] No roomId provided in audio stream`);
      return;
    }

    if (!audio) {
      console.error(`[Audio][${roomId}] No audio data provided`);
      return;
    }

    // Verify speaker
    const room = await ctx.roomService.getRoom(roomId);
    if (!room) {
      console.warn(`[Audio][${roomId}] Room not found`);
      return;
    }

    if (room.speakerId !== socket.id) {
      console.warn(`[Audio][${roomId}] Unauthorized audio stream attempt (expected: ${room.speakerId}, got: ${socket.id})`);
      return;
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audio, 'base64');

    // Validate audio buffer
    if (audioBuffer.length === 0) {
      console.warn(`[Audio][${roomId}] Empty audio buffer received`);
      return;
    }

    // Log first chunk with detailed info
    const count = (ctx.audioChunksReceived.get(roomId) || 0) + 1;
    ctx.audioChunksReceived.set(roomId, count);

    if (count === 1) {
      console.log(`[Audio][${roomId}] First chunk received:`);
      console.log(`  - Buffer size: ${audioBuffer.length} bytes`);
      console.log(`  - Base64 size: ${audio.length} chars`);
      console.log(`  - Expected format: 16-bit PCM, 16kHz mono`);
      console.log(`  - Sample count: ~${audioBuffer.length / 2} samples`);
      console.log(`  - Duration: ~${(audioBuffer.length / 2 / 16000).toFixed(3)}s`);
    } else if (count === 10) {
      console.log(`[Audio][${roomId}] 10 chunks received and processing`);
    }

    // Check if STT client exists
    if (!ctx.sttManager.hasActiveClient(roomId)) {
      if (count === 1) {
        console.error(`[Audio][${roomId}] No active STT client - audio will be dropped`);
      }
      return;
    }

    // Send to STT
    ctx.sttManager.sendAudio(roomId, audioBuffer);

  } catch (error) {
    console.error(`[Audio] Stream error:`, error);
    console.error(`[Audio] Stack:`, error instanceof Error ? error.stack : 'N/A');
  }
}
