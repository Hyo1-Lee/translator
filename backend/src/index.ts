import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
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
    await recordingRoutes(recordingFastify, prisma);
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

  fastify.get('/api/v1/rooms/:roomCode/stats', async (request, reply) => {
    const { roomCode } = request.params as { roomCode: string };
    const transcriptService = new TranscriptService();
    const stats = await transcriptService.getStats(roomCode);
    return stats;
  });

  fastify.get('/api/v1/rooms/:roomCode/export', async (request, reply) => {
    const { roomCode } = request.params as { roomCode: string };
    const transcriptService = new TranscriptService();
    const transcripts = await transcriptService.getAllTranscripts(roomCode);
    return transcripts;
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
  const translationService = new TranslationService({
    apiKey: process.env.OPENAI_API_KEY || ''
  });
  const sttProvider = (process.env.STT_PROVIDER as 'rtzr' | 'openai') || 'rtzr';
  const promptTemplate = process.env.STT_PROMPT_TEMPLATE || 'church';

  console.log('='.repeat(50));
  console.log('🎤 STT Configuration');
  console.log(`📌 Provider: ${sttProvider.toUpperCase()}`);
  console.log(`📝 Prompt Template: ${promptTemplate}`);
  if (sttProvider === 'openai') {
    const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
    console.log(`🤖 Model: ${model}`);
    console.log(`🎚️  VAD Threshold: ${process.env.OPENAI_VAD_THRESHOLD || '0.5'}`);
    console.log(`⏱️  VAD Silence: ${process.env.OPENAI_VAD_SILENCE || '500'}ms`);
  } else {
    console.log(`🌐 RTZR API: ${process.env.RTZR_API_URL || 'https://openapi.vito.ai'}`);
  }
  console.log('='.repeat(50));

  const sttManager = new STTManager(
    {
      provider: sttProvider,
      defaultPromptTemplate: promptTemplate,
      rtzr: {
        clientId: process.env.RTZR_CLIENT_ID || '',
        clientSecret: process.env.RTZR_CLIENT_SECRET || '',
        apiUrl: process.env.RTZR_API_URL || 'https://openapi.vito.ai'
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17',
        voice: (process.env.OPENAI_VOICE as any) || 'alloy',
        temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.8'),
        maxOutputTokens: process.env.OPENAI_MAX_TOKENS === 'inf' ? 'inf' : parseInt(process.env.OPENAI_MAX_TOKENS || '4096'),
        vadThreshold: parseFloat(process.env.OPENAI_VAD_THRESHOLD || '0.5'),
        vadSilenceDuration: parseInt(process.env.OPENAI_VAD_SILENCE || '500'),
        prefixPadding: parseInt(process.env.OPENAI_PREFIX_PADDING || '300'),
        turnDetection: (process.env.OPENAI_TURN_DETECTION as any) || 'server_vad'
      }
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
  await closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
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