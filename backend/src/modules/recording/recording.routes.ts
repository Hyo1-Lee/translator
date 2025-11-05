import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { RecordingService } from './recording.service';
import { PrismaClient } from '@prisma/client';
import { AuthService } from '../auth/auth.service';

export async function recordingRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  const recordingService = new RecordingService(prisma);
  const authService = new AuthService(prisma);

  // Middleware to verify JWT token
  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ success: false, message: 'Unauthorized' });
      }

      const token = authHeader.substring(7);
      const payload = authService.verifyAccessToken(token);

      (request as any).user = payload;
    } catch (error) {
      return reply.code(401).send({ success: false, message: 'Invalid token' });
    }
  };

  // Save current session as recording
  fastify.post('/save', { preHandler: authenticate }, async (request, reply) => {
    try {
      const userId = (request as any).user.userId;
      const { roomCode, roomName } = request.body as any;

      if (!roomCode) {
        return reply.code(400).send({ success: false, message: 'Room code is required' });
      }

      const recording = await recordingService.saveRecording({
        userId,
        roomCode,
        roomName
      });

      return { success: true, data: recording };
    } catch (error) {
      console.error('[Recording] Save error:', error);
      return reply.code(500).send({ success: false, message: 'Failed to save recording' });
    }
  });

  // Get all user recordings
  fastify.get('/list', { preHandler: authenticate }, async (request, reply) => {
    try {
      const userId = (request as any).user.userId;
      const recordings = await recordingService.getUserRecordings(userId);

      return { success: true, data: recordings };
    } catch (error) {
      console.error('[Recording] List error:', error);
      return reply.code(500).send({ success: false, message: 'Failed to get recordings' });
    }
  });

  // Get user stats
  fastify.get('/stats/summary', { preHandler: authenticate }, async (request, reply) => {
    try {
      const userId = (request as any).user.userId;
      const stats = await recordingService.getUserStats(userId);

      return { success: true, data: stats };
    } catch (error) {
      console.error('[Recording] Stats error:', error);
      return reply.code(500).send({ success: false, message: 'Failed to get stats' });
    }
  });

  // Get single recording
  fastify.get('/:recordingId', { preHandler: authenticate }, async (request, reply) => {
    try {
      const userId = (request as any).user.userId;
      const { recordingId } = request.params as any;

      const recording = await recordingService.getRecording(recordingId, userId);

      if (!recording) {
        return reply.code(404).send({ success: false, message: 'Recording not found' });
      }

      return { success: true, data: recording };
    } catch (error) {
      console.error('[Recording] Get error:', error);
      return reply.code(500).send({ success: false, message: 'Failed to get recording' });
    }
  });

  // Delete recording
  fastify.delete('/:recordingId', { preHandler: authenticate }, async (request, reply) => {
    try {
      const userId = (request as any).user.userId;
      const { recordingId } = request.params as any;

      const success = await recordingService.deleteRecording(recordingId, userId);

      if (!success) {
        return reply.code(404).send({ success: false, message: 'Recording not found' });
      }

      return { success: true, message: 'Recording deleted' };
    } catch (error) {
      console.error('[Recording] Delete error:', error);
      return reply.code(500).send({ success: false, message: 'Failed to delete recording' });
    }
  });

  // Update recording name
  fastify.patch('/:recordingId/name', { preHandler: authenticate }, async (request, reply) => {
    try {
      const userId = (request as any).user.userId;
      const { recordingId } = request.params as any;
      const { roomName } = request.body as any;

      if (!roomName) {
        return reply.code(400).send({ success: false, message: 'Name is required' });
      }

      const success = await recordingService.updateRecordingName(recordingId, userId, roomName);

      if (!success) {
        return reply.code(404).send({ success: false, message: 'Recording not found' });
      }

      return { success: true, message: 'Recording name updated' };
    } catch (error) {
      console.error('[Recording] Update name error:', error);
      return reply.code(500).send({ success: false, message: 'Failed to update recording name' });
    }
  });
}
