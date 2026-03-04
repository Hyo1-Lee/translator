import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { connectDatabase, closeDatabase } from './infrastructure/database/sequelize';

// Load environment variables
dotenv.config();

// Import services
import { RoomService } from './modules/room/room-service';
import { TranscriptService } from './modules/room/transcript-service';
import { TranslationService } from './modules/translation/translation-service';
import { STTManager } from './modules/stt/stt-manager';
import { SocketHandler } from './modules/socket/socket-handler';
import { SessionService } from './services/session-service';

// Configuration
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : [FRONTEND_URL];

async function bootstrap() {
  // Connect to database
  await connectDatabase();

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
    origin: ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false
  });

  // Global Rate Limiting
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: (request, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `요청이 너무 많습니다. ${context.after}에 다시 시도해주세요.`,
      retryAfter: context.after
    })
  });

  // Health check endpoint
  fastify.get('/health', async (request, reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };
  });

  // Auth Routes
  fastify.register(async (authFastify) => {
    const { authRoutes } = await import('./modules/auth/auth.routes');
    await authRoutes(authFastify);
  }, { prefix: '/api/v1/auth' });

  // Dashboard Routes
  fastify.register(async (dashboardFastify) => {
    const { dashboardRoutes } = await import('./modules/dashboard/dashboard.routes');
    await dashboardRoutes(dashboardFastify);
  }, { prefix: '/api/v1/dashboard' });

  // Recording Routes
  fastify.register(async (recordingFastify) => {
    const { recordingRoutes } = await import('./modules/recording/recording.routes');
    await recordingRoutes(recordingFastify);
  }, { prefix: '/api/v1/recordings' });

  // API Routes
  fastify.get('/api/v1/rooms/:roomCode', async (request, reply) => {
    const { roomCode } = request.params as { roomCode: string };
    const roomService = new RoomService();
    const room = await roomService.getRoom(roomCode);

    if (!room) {
      reply.code(404);
      return { error: 'Room not found' };
    }

    return room;
  });

  fastify.get('/api/v1/rooms/:roomCode/segments', async (request, reply) => {
    const { roomCode } = request.params as { roomCode: string };
    const transcriptService = new TranscriptService();
    const segments = await transcriptService.getAllSegments(roomCode);
    return segments;
  });

  // Initialize Socket.IO
  const io = new Server(fastify.server, {
    cors: {
      origin: ALLOWED_ORIGINS,
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  // Initialize services
  const roomService = new RoomService();
  const transcriptService = new TranscriptService();

  // Translation service (Gemini 2-pass: correction + translation)
  const translationService = new TranslationService({
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    correctionModel: process.env.GEMINI_CORRECTION_MODEL || 'gemini-2.0-flash',
  });

  // In-memory session service (translation context)
  const sessionService = new SessionService();

  console.log('[Bootstrap] Translation service initialized (Gemini)');
  console.log(`[Bootstrap] - Translation Model: ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}`);
  console.log(`[Bootstrap] - Correction Model: ${process.env.GEMINI_CORRECTION_MODEL || 'gemini-2.0-flash'}`);

  // STT Manager - Deepgram only, Nova-3 fixed
  const sttManager = new STTManager({
    deepgram: {
      apiKey: process.env.DEEPGRAM_API_KEY || '',
    },
  });

  // Initialize Socket handler
  new SocketHandler(io, roomService, transcriptService, sttManager, translationService, sessionService);

  // Cleanup job - run every hour
  setInterval(async () => {
    try {
      await roomService.cleanupOldRooms(24);
      await transcriptService.cleanupOldData(7);
    } catch (error) {
      console.error('[Cleanup] Error:', error);
    }
  }, 60 * 60 * 1000);

  // Start server
  try {
    await fastify.listen({ port: Number(PORT), host: '0.0.0.0' });
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  await closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDatabase();
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
