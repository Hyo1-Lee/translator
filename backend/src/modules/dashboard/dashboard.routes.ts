import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { AuthService } from '../auth/auth.service';

export async function dashboardRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  const authService = new AuthService(prisma);

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

      const rooms = await prisma.room.findMany({
        where: {
          userId,
        },
        include: {
          roomSettings: true,
          _count: {
            select: {
              listeners: true,
              transcripts: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return reply.send({
        success: true,
        data: rooms,
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
      const totalRooms = await prisma.room.count({
        where: { userId },
      });

      // Active rooms
      const activeRooms = await prisma.room.count({
        where: {
          userId,
          status: 'ACTIVE',
        },
      });

      // Total transcripts
      const totalTranscripts = await prisma.transcript.count({
        where: {
          room: {
            userId,
          },
        },
      });

      // Total listeners (unique)
      const rooms = await prisma.room.findMany({
        where: { userId },
        include: {
          _count: {
            select: {
              listeners: true,
            },
          },
        },
      });

      const totalListeners = rooms.reduce((sum, room) => sum + room._count.listeners, 0);

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

      const savedTranscripts = await prisma.savedTranscript.findMany({
        where: { userId },
        orderBy: {
          createdAt: 'desc',
        },
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
  fastify.delete('/rooms/:roomId', {
    preHandler: verifyAuth,
  }, async (request: FastifyRequest<{ Params: { roomId: string } }>, reply: FastifyReply) => {
    try {
      const userId = (request as any).userId;
      const { roomId } = request.params;

      // Check if room belongs to user
      const room = await prisma.room.findFirst({
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

      // Delete room (cascade will delete related data)
      await prisma.room.delete({
        where: { id: roomId },
      });

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

  // Save a transcript
  fastify.post('/transcripts', {
    preHandler: verifyAuth,
  }, async (request: FastifyRequest<{ Body: { roomCode: string; title: string; content: string } }>, reply: FastifyReply) => {
    try {
      const userId = (request as any).userId;
      const { roomCode, title, content } = request.body;

      const savedTranscript = await prisma.savedTranscript.create({
        data: {
          userId,
          roomCode,
          title,
          content,
        },
      });

      return reply.send({
        success: true,
        data: savedTranscript,
      });
    } catch (error: any) {
      console.error('[Dashboard] Save transcript error:', error);
      return reply.code(500).send({
        success: false,
        message: error.message || 'Failed to save transcript',
      });
    }
  });

  // Delete a saved transcript
  fastify.delete('/transcripts/:transcriptId', {
    preHandler: verifyAuth,
  }, async (request: FastifyRequest<{ Params: { transcriptId: string } }>, reply: FastifyReply) => {
    try {
      const userId = (request as any).userId;
      const { transcriptId } = request.params;

      // Check if transcript belongs to user
      const transcript = await prisma.savedTranscript.findFirst({
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
      await prisma.savedTranscript.delete({
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
