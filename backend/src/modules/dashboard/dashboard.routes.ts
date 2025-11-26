import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from '../auth/auth.service';
import { Room, RoomStatus } from '../../models/Room';
import { RoomSettings } from '../../models/RoomSettings';
import { Transcript } from '../../models/Transcript';
import { Listener } from '../../models/Listener';
import { SavedTranscript } from '../../models/SavedTranscript';
import { SttText } from '../../models/SttText';
import { TranslationText } from '../../models/TranslationText';
import { Op } from 'sequelize';

export async function dashboardRoutes(fastify: FastifyInstance) {
  const authService = new AuthService();

  // Middleware to verify JWT token
  const verifyAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({
          success: false,
          message: 'Unauthorized',
        });
      }

      const token = authHeader.substring(7);
      const payload = authService.verifyAccessToken(token);
      (request as any).userId = payload.userId;
    } catch (error: any) {
      return reply.code(401).send({
        success: false,
        message: error.message || 'Unauthorized',
      });
    }
  };

  // Get user's rooms
  fastify.get('/rooms', {
    preHandler: verifyAuth,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request as any).userId;

      const rooms = await Room.findAll({
        where: { userId },
        include: [
          RoomSettings,
          {
            model: Listener,
            attributes: ['id'],
            where: { leftAt: null },  // Only count active listeners
            required: false  // Use LEFT JOIN to still get rooms even with no active listeners
          },
          {
            model: Transcript,
            attributes: ['id']
          }
        ],
        order: [['createdAt', 'DESC']]
      });

      // Transform the data to include counts
      const roomsData = rooms.map((room: any) => {
        const roomJson = room.toJSON();
        return {
          ...roomJson,
          _count: {
            listeners: roomJson.listeners?.length || 0,
            transcripts: roomJson.transcripts?.length || 0
          },
          // Remove the full arrays to reduce payload size
          listeners: undefined,
          transcripts: undefined
        };
      });

      return reply.send({
        success: true,
        data: roomsData,
      });
    } catch (error: any) {
      console.error('[Dashboard] Get rooms error:', error);
      return reply.code(500).send({
        success: false,
        message: error.message || 'Failed to fetch rooms',
      });
    }
  });

  // Get room statistics
  fastify.get('/stats', {
    preHandler: verifyAuth,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request as any).userId;

      // Total rooms
      const totalRooms = await Room.count({
        where: { userId },
      });

      // Active rooms
      const activeRooms = await Room.count({
        where: {
          userId,
          status: RoomStatus.ACTIVE,
        },
      });

      // Total transcripts
      const totalTranscripts = await Transcript.count({
        include: [{
          model: Room,
          where: { userId },
          required: true
        }]
      });

      // Total listeners (only active ones)
      const totalListeners = await Listener.count({
        where: { leftAt: null },  // Only count active listeners
        include: [{
          model: Room,
          where: { userId },
          required: true
        }]
      });

      return reply.send({
        success: true,
        data: {
          totalRooms,
          activeRooms,
          totalTranscripts,
          totalListeners,
        },
      });
    } catch (error: any) {
      console.error('[Dashboard] Get stats error:', error);
      return reply.code(500).send({
        success: false,
        message: error.message || 'Failed to fetch statistics',
      });
    }
  });

  // Get saved transcripts
  fastify.get('/transcripts', {
    preHandler: verifyAuth,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request as any).userId;

      const savedTranscripts = await SavedTranscript.findAll({
        where: { userId },
        order: [['createdAt', 'DESC']]
      });

      return reply.send({
        success: true,
        data: savedTranscripts,
      });
    } catch (error: any) {
      console.error('[Dashboard] Get transcripts error:', error);
      return reply.code(500).send({
        success: false,
        message: error.message || 'Failed to fetch transcripts',
      });
    }
  });

  // Delete a room
  fastify.delete<{ Params: { roomId: string } }>('/rooms/:roomId', {
    preHandler: verifyAuth,
  }, async (request, reply) => {
    try {
      const userId = (request as any).userId;
      const { roomId } = request.params;

      // Check if room belongs to user
      const room = await Room.findOne({
        where: {
          id: roomId,
          userId,
        },
      });

      if (!room) {
        return reply.code(404).send({
          success: false,
          message: 'Room not found or unauthorized',
        });
      }

      // Delete room and related data in correct order to avoid foreign key constraint errors
      // Order: TranslationText -> SttText -> Listener -> Transcript -> RoomSettings -> Room
      await TranslationText.destroy({ where: { roomId } });
      await SttText.destroy({ where: { roomId } });
      await Listener.destroy({ where: { roomId } });
      await Transcript.destroy({ where: { roomId } });
      await RoomSettings.destroy({ where: { roomId } });
      await Room.destroy({ where: { id: roomId } });

      return reply.send({
        success: true,
        message: 'Room deleted successfully',
      });
    } catch (error: any) {
      console.error('[Dashboard] Delete room error:', error);
      return reply.code(500).send({
        success: false,
        message: error.message || 'Failed to delete room',
      });
    }
  });

  // Save a session (room with all transcripts)
  fastify.post<{ Body: { roomId: string; roomName?: string } }>('/sessions/save', {
    preHandler: verifyAuth,
  }, async (request, reply) => {
    try {
      const userId = (request as any).userId;
      const { roomId, roomName } = request.body;

      // Get room and verify ownership
      const room = await Room.findOne({
        where: {
          id: roomId,
          userId,
        },
      });

      if (!room) {
        return reply.code(404).send({
          success: false,
          message: 'Room not found or unauthorized',
        });
      }

      // Get STT texts for this room
      const sttTexts = await SttText.findAll({
        where: { roomId: room.id },
        order: [['timestamp', 'ASC']]
      });

      // Get translations for this room (only final translations, not partial)
      const translations = await TranslationText.findAll({
        where: {
          roomId: room.id,
          isPartial: false
        },
        order: [['timestamp', 'ASC']]
      });

      // Build transcript data: group translations by originalText (STT)
      const transcriptsData: Array<{
        korean: string;
        english: string;
        translations: Record<string, string>;
        timestamp: Date;
      }> = [];

      // Group translations by originalText
      const translationsByOriginal = new Map<string, { translations: Record<string, string>, timestamp: Date }>();

      for (const t of translations) {
        const key = t.originalText;
        if (!translationsByOriginal.has(key)) {
          translationsByOriginal.set(key, { translations: {}, timestamp: t.timestamp });
        }
        const entry = translationsByOriginal.get(key)!;
        entry.translations[t.targetLanguage] = t.translatedText;
      }

      // Convert to array format
      for (const [originalText, data] of translationsByOriginal) {
        transcriptsData.push({
          korean: originalText,
          english: data.translations['en'] || '',
          translations: data.translations,
          timestamp: data.timestamp
        });
      }

      // Sort by timestamp
      transcriptsData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      console.log('[Dashboard] Saving session with', transcriptsData.length, 'transcripts from', sttTexts.length, 'STT texts and', translations.length, 'translations');

      const savedTranscript = await SavedTranscript.create({
        userId,
        roomCode: room.roomCode,
        roomName: roomName || room.speakerName || `Session ${room.roomCode}`,
        transcripts: JSON.stringify(transcriptsData),
      });

      return reply.send({
        success: true,
        data: savedTranscript,
        message: `Session saved with ${transcriptsData.length} transcripts`,
      });
    } catch (error: any) {
      console.error('[Dashboard] Save session error:', error);
      return reply.code(500).send({
        success: false,
        message: error.message || 'Failed to save session',
      });
    }
  });

  // Get saved transcript detail
  fastify.get<{ Params: { transcriptId: string } }>('/transcripts/:transcriptId', {
    preHandler: verifyAuth,
  }, async (request, reply) => {
    try {
      const userId = (request as any).userId;
      const { transcriptId } = request.params;

      const transcript = await SavedTranscript.findOne({
        where: {
          id: transcriptId,
          userId,
        },
      });

      if (!transcript) {
        return reply.code(404).send({
          success: false,
          message: 'Transcript not found or unauthorized',
        });
      }

      // Parse transcripts JSON
      let transcriptsData = [];
      try {
        transcriptsData = JSON.parse(transcript.transcripts || '[]');
      } catch (e) {
        console.error('Failed to parse transcripts:', e);
      }

      return reply.send({
        success: true,
        data: {
          ...transcript.toJSON(),
          transcriptsData
        },
      });
    } catch (error: any) {
      console.error('[Dashboard] Get transcript detail error:', error);
      return reply.code(500).send({
        success: false,
        message: error.message || 'Failed to fetch transcript',
      });
    }
  });

  // Delete a saved transcript
  fastify.delete<{ Params: { transcriptId: string } }>('/transcripts/:transcriptId', {
    preHandler: verifyAuth,
  }, async (request, reply) => {
    try {
      const userId = (request as any).userId;
      const { transcriptId } = request.params;

      // Check if transcript belongs to user
      const transcript = await SavedTranscript.findOne({
        where: {
          id: transcriptId,
          userId,
        },
      });

      if (!transcript) {
        return reply.code(404).send({
          success: false,
          message: 'Transcript not found or unauthorized',
        });
      }

      // Delete transcript
      await SavedTranscript.destroy({
        where: { id: transcriptId },
      });

      return reply.send({
        success: true,
        message: 'Transcript deleted successfully',
      });
    } catch (error: any) {
      console.error('[Dashboard] Delete transcript error:', error);
      return reply.code(500).send({
        success: false,
        message: error.message || 'Failed to delete transcript',
      });
    }
  });
}
