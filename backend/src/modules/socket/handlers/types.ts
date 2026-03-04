import { Server, Socket } from 'socket.io';
import { RoomService } from '../../room/room-service';
import { TranscriptService } from '../../room/transcript-service';
import { STTManager } from '../../stt/stt-manager';
import { TranslationService } from '../../translation/translation-service';
import { SessionService } from '../../../services/session-service';

export interface AudioStreamData {
  roomId: string;
  audio: string; // Base64 encoded audio
}

export interface AudioBlobData {
  roomId: string;
  audio: Buffer;
}

export interface HandlerContext {
  io: Server;
  roomService: RoomService;
  transcriptService: TranscriptService;
  sttManager: STTManager;
  translationService: TranslationService;
  sessionService: SessionService;
  audioChunksReceived: Map<string, number>;
  setupSttCallbacks: (roomCode: string, promptTemplate?: string, sourceLanguage?: string) => Promise<void>;
  sendTranscriptHistory: (socket: Socket, roomId: string) => Promise<void>;
  sendTranslationHistory: (socket: Socket, roomId: string) => Promise<void>;
  cleanupTranslationState: (roomId: string) => void;
}
