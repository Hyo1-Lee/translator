import { FastifyPluginAsync } from 'fastify';
import { RoomService } from '../services/room.service';
import { prisma } from '../utils/prisma';

export const roomRoutes: FastifyPluginAsync = async (fastify) => {
  const roomService = new RoomService(prisma);

  // Health check
  fastify.get('/health', async (request, reply) => {
    return {
      status: 'healthy',
      service: 'BridgeSpeak Node.js Backend',
      timestamp: new Date().toISOString(),
    };
  });

  // Get all active rooms
  fastify.get('/rooms', async (request, reply) => {
    try {
      const rooms = await roomService.getActiveRooms();
      return {
        success: true,
        data: rooms,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch rooms',
      });
    }
  });

  // Get specific room
  fastify.get<{
    Params: { roomCode: string };
  }>('/rooms/:roomCode', async (request, reply) => {
    try {
      const { roomCode } = request.params;
      const room = await roomService.getRoom(roomCode);

      if (!room) {
        return reply.status(404).send({
          success: false,
          error: 'Room not found',
        });
      }

      return {
        success: true,
        data: room,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch room',
      });
    }
  });

  // Get room status (for monitoring)
  fastify.get('/status', async (request, reply) => {
    try {
      const activeRooms = await roomService.getActiveRooms();
      const totalListeners = activeRooms.reduce(
        (sum, room) => sum + (room._count?.listeners || 0),
        0
      );

      return {
        status: 'running',
        service: 'BridgeSpeak',
        version: '1.0.0',
        activeRooms: activeRooms.length,
        totalListeners,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch status',
      });
    }
  });
};