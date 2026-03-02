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
      await ctx.setupSttCallbacks(roomId, settings.promptTemplate || updatedSettings.promptTemplate);
    }

    // If translation settings changed, reset session context
    const translationSettingsChanged =
      settings.enableTranslation !== undefined ||
      settings.sourceLanguage !== undefined ||
      settings.targetLanguagesArray !== undefined ||
      settings.environmentPreset !== undefined ||
      settings.customEnvironmentDescription !== undefined ||
      settings.customGlossary !== undefined ||
      settings.enableStreaming !== undefined;

    if (translationSettingsChanged) {
      // Reset session context for new settings
      ctx.sessionService.removeSession(roomId);
      console.log(`[Settings][${roomId}] Reset session context for new settings`);
    }

    // Broadcast to room
    ctx.io.to(roomId).emit('settings-updated', updatedSettings);

  } catch (error) {
    console.error('[Settings] Update error:', error);
    socket.emit('error', { message: 'Failed to update settings' });
  }
}
