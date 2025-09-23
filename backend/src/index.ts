import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Load environment variables
dotenv.config();

// Import services
import { RoomService } from './modules/room/room-service';
import { TranscriptService } from './modules/room/transcript-service';
import { TranslationService } from './modules/translation/translation-service';
import { STTManager } from './modules/stt/stt-manager';
import { SocketHandler } from './modules/socket/socket-handler';

// Configuration
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Initialize Prisma
const prisma = new PrismaClient();

async function bootstrap() {
  // Create Fastify instance
  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          translateTime: 'HH:MM:ss Z'
        }
      }
    }
  });

  // Register plugins
  await fastify.register(cors, {
    origin: [FRONTEND_URL],
    credentials: true
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false
  });

  // Health check endpoint
  fastify.get('/health', async (request, reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };
  });

  // API Routes
  fastify.get('/api/v1/rooms/:roomCode', async (request, reply) => {
    const { roomCode } = request.params as { roomCode: string };
    const roomService = new RoomService(prisma);
    const room = await roomService.getRoom(roomCode);

    if (!room) {
      reply.code(404);
      return { error: 'Room not found' };
    }

    return room;
  });

  fastify.get('/api/v1/rooms/:roomCode/stats', async (request, reply) => {
    const { roomCode } = request.params as { roomCode: string };
    const transcriptService = new TranscriptService(prisma);
    const stats = await transcriptService.getStats(roomCode);
    return stats;
  });

  fastify.get('/api/v1/rooms/:roomCode/export', async (request, reply) => {
    const { roomCode } = request.params as { roomCode: string };
    const transcriptService = new TranscriptService(prisma);
    const transcripts = await transcriptService.getAllTranscripts(roomCode);
    return transcripts;
  });

  // Initialize Socket.IO
  const io = new Server(fastify.server, {
    cors: {
      origin: [FRONTEND_URL],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  // Initialize services
  const roomService = new RoomService(prisma);
  const transcriptService = new TranscriptService(prisma);
  const translationService = new TranslationService({
    apiKey: process.env.OPENAI_API_KEY || ''
  });
  const sttManager = new STTManager(
    {
      clientId: process.env.RTZR_CLIENT_ID || '',
      clientSecret: process.env.RTZR_CLIENT_SECRET || '',
      apiUrl: process.env.RTZR_API_URL || 'https://openapi.vito.ai'
    },
    translationService
  );

  // Initialize Socket handler
  new SocketHandler(io, roomService, transcriptService, sttManager);

  // Cleanup job - run every hour
  setInterval(async () => {
    try {
      const cleanedRooms = await roomService.cleanupOldRooms(24);
      if (cleanedRooms > 0) {
        console.log(`[Cleanup] Closed ${cleanedRooms} old rooms`);
      }

      const { sttTexts, translations } = await transcriptService.cleanupOldTranscripts(7);
      if (sttTexts > 0 || translations > 0) {
        console.log(`[Cleanup] Removed ${sttTexts} STT texts and ${translations} translations`);
      }
    } catch (error) {
      console.error('[Cleanup] Error:', error);
    }
  }, 60 * 60 * 1000);

  // Start server
  try {
    await fastify.listen({ port: Number(PORT), host: '0.0.0.0' });
    console.log('='.repeat(50));
    console.log('🚀 Real-time Translation Service');
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🌐 Frontend: ${FRONTEND_URL}`);
    console.log('='.repeat(50));
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the server
bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});