import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import services
import { RoomService } from './services/room.service';
import { TranscriptService } from './services/transcript.service';
import { prisma } from './utils/prisma';

// Import routes
import { roomRoutes } from './routes/room.routes';

const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:4000';

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
    origin: [FRONTEND_URL, 'http://localhost:3001'],
    credentials: true
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false
  });

  // Register routes
  await fastify.register(roomRoutes, { prefix: '/api/v1' });

  // Socket.IO setup
  const io = new Server(fastify.server, {
    cors: {
      origin: [FRONTEND_URL, 'http://localhost:3001'],
      credentials: true
    }
  });

  // Initialize services
  const roomService = new RoomService(prisma);
  const transcriptService = new TranscriptService(prisma);

  // Connect to Python backend for STT/Translation
  const pythonSocket: ClientSocket = ioClient(PYTHON_BACKEND_URL, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
  });

  pythonSocket.on('connect', () => {
    console.log('[Python Backend] Connected');
  });

  pythonSocket.on('disconnect', () => {
    console.log('[Python Backend] Disconnected');
  });

  // Forward transcripts from Python to clients
  pythonSocket.on('transcript', async (data: any) => {

    // Forward to the room with appropriate event name
    if (data.roomId) {
      if (data.type === 'stt') {
        // Real-time STT text - save to DB
        try {
          await transcriptService.saveSttText(
            data.roomId,
            data.text
          );
        } catch (error) {
          console.error('[STT] Failed to save to DB:', error);
        }

        // Forward to clients
        io.to(data.roomId).emit('stt-text', {
          text: data.text,
          timestamp: data.timestamp
        });
      } else if (data.type === 'translation') {
        // Translation batch - save to DB
        try {
          await transcriptService.saveTranscript(
            data.roomId,
            data.korean,
            data.english,
            data.batchId
          );
        } catch (error) {
          console.error('[Transcript] Failed to save to DB:', error);
        }

        // Forward to clients
        io.to(data.roomId).emit('translation-batch', {
          batchId: data.batchId,
          korean: data.korean,
          english: data.english,
          timestamp: data.timestamp
        });
      }
    }
  });

  // Socket.IO event handlers
  io.on('connection', (socket) => {

    // Create room (Speaker)
    socket.on('create-room', async (data) => {
      try {
        const speakerName = data.name || 'Speaker';
        const room = await roomService.createRoom(speakerName, socket.id);

        socket.join(room.roomCode);

        // Notify Python backend to create STT client for this room
        if (pythonSocket && pythonSocket.connected) {
          pythonSocket.emit('create_room_from_nodejs', {
            roomId: room.roomCode,
            speakerName: speakerName,
            speakerId: socket.id
          });
        }

        socket.emit('room-created', { roomId: room.roomCode });

        // Load and send existing transcripts (in case of reconnection)
        try {
          // Load STT texts
          const sttTexts = await transcriptService.getRecentSttTexts(room.roomCode, 100);

          // Send existing STT texts in reverse order (oldest first)
          sttTexts.reverse().forEach((sttText: any) => {
            socket.emit('stt-text', {
              text: sttText.text,
              timestamp: sttText.timestamp.getTime(),
              isHistory: true  // Flag to indicate this is historical data
            });
          });

          // Load translations
          const transcripts = await transcriptService.getRecentTranscripts(room.roomCode, 30);

          // Send existing transcripts in reverse order (oldest first)
          transcripts.reverse().forEach((transcript: any) => {
            socket.emit('translation-batch', {
              batchId: transcript.batchId || transcript.id,
              korean: transcript.korean,
              english: transcript.english,
              timestamp: transcript.timestamp.getTime(),
              isHistory: true  // Flag to indicate this is historical data
            });
          });

        } catch (error) {
          console.error('[Room] Failed to load transcripts:', error);
        }

      } catch (error) {
        console.error('[Room] Creation error:', error);
        socket.emit('error', { message: 'Failed to create room' });
      }
    });

    // Join room (Listener)
    socket.on('join-room', async (data) => {
      try {
        const { roomId } = data;
        const room = await roomService.getRoom(roomId);

        if (!room) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        await roomService.addListener(roomId, socket.id, data.name);
        socket.join(roomId);

        socket.emit('room-joined', {
          roomId: room.roomCode,
          speakerName: room.speakerName
        });

        // Load and send existing transcripts
        try {
          // Load STT texts
          const sttTexts = await transcriptService.getRecentSttTexts(roomId, 100);

          // Send existing STT texts in reverse order (oldest first)
          sttTexts.reverse().forEach((sttText: any) => {
            socket.emit('stt-text', {
              text: sttText.text,
              timestamp: sttText.timestamp.getTime(),
              isHistory: true  // Flag to indicate this is historical data
            });
          });

          // Load translations
          const transcripts = await transcriptService.getRecentTranscripts(roomId, 30);

          // Send existing transcripts in reverse order (oldest first)
          transcripts.reverse().forEach((transcript: any) => {
            socket.emit('translation-batch', {
              batchId: transcript.batchId || transcript.id,
              korean: transcript.korean,
              english: transcript.english,
              timestamp: transcript.timestamp.getTime(),
              isHistory: true  // Flag to indicate this is historical data
            });
          });

        } catch (error) {
          console.error('[Room] Failed to load transcripts:', error);
        }

        // Notify speaker about listener count
        const listenerCount = await roomService.getListenerCount(roomId);
        io.to(roomId).emit('listener-count', { count: listenerCount });

      } catch (error) {
        console.error('[Room] Join error:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // Handle audio stream from speaker
    socket.on('audio-stream', async (data) => {
      try {
        const { roomId, audio } = data;

        // Forward to Python backend for STT processing
        pythonSocket.emit('audio_stream', {  // Python uses underscore, not hyphen!
          roomId,
          audio,
          speakerId: socket.id
        });

      } catch (error) {
        console.error('[Audio] Stream error:', error);
      }
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      try {
        await roomService.handleDisconnect(socket.id);
        console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
      } catch (error) {
        console.error('[Disconnect] Error:', error);
      }
    });
  });

  // Start server
  try {
    await fastify.listen({ port: Number(PORT), host: '0.0.0.0' });
    console.log('='.repeat(50));
    console.log('🚀 BridgeSpeak Node.js Backend Started');
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV}`);
    console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);
    console.log('='.repeat(50));
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  pythonSocket.disconnect();
  await prisma.$disconnect();
  process.exit(0);
});

// Start the server
bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});