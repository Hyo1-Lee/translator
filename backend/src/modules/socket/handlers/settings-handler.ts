import { Socket } from 'socket.io';
import { HandlerContext } from './types';

export async function handleUpdateSettings(
  ctx: HandlerContext,
  socket: Socket,
  data: any
): Promise<void> {
  try {
    const { roomId, settings } = data;

    // Verify speaker
    const room = await ctx.roomService.getRoom(roomId);
    if (!room || room.speakerId !== socket.id) {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }

    // Update settings in database
    const updatedSettings = await ctx.roomService.updateRoomSettings(roomId, {
      roomTitle: settings.roomTitle,
      promptTemplate: settings.promptTemplate,
      customPrompt: settings.customPrompt,
      maxListeners: settings.maxListeners,
      enableAutoScroll: settings.enableAutoScroll,
      // 번역 관련 설정
      sourceLanguage: settings.sourceLanguage,
      targetLanguagesArray: settings.targetLanguagesArray,
      environmentPreset: settings.environmentPreset,
      customEnvironmentDescription: settings.customEnvironmentDescription,
      customGlossary: settings.customGlossary,
      enableStreaming: settings.enableStreaming,
      enableTranslation: settings.enableTranslation
    });

    // Update password if provided
    if (settings.password !== undefined) {
      await ctx.roomService.updateRoomPassword(roomId, settings.password);
    }

    // If prompt template changed, restart STT client
    if (settings.promptTemplate) {
      ctx.sttManager.removeClient(roomId);

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
      const existingManager = ctx.translationManagers.get(roomId);
      if (existingManager) {
        await existingManager.cleanup();
        ctx.translationManagers.delete(roomId);
        console.log(`[Settings][${roomId}] Cleaned up old TranslationManager`);
      }

      // Recreate if translation is enabled
      if (updatedSettings.enableTranslation) {
        await ctx.createTranslationManager(roomId, updatedSettings);
      }
    }

    // Broadcast to room
    ctx.io.to(roomId).emit('settings-updated', updatedSettings);

  } catch (error) {
    console.error('[Settings] Update error:', error);
    socket.emit('error', { message: 'Failed to update settings' });
  }
}
