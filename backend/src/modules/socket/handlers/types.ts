import { Server, Socket } from 'socket.io';
import { RoomService } from '../../room/room-service';
import { TranscriptService } from '../../room/transcript-service';
import { STTManager } from '../../stt/stt-manager';
import { TranslationService } from '../../translation/translation-service';
import { AzureTranslateService } from '../../translation/azure-translate.service';
import { TranslationManager } from '../../translation/translation-manager';

export interface AudioStreamData {
  roomId: string;
  audio: string; // Base64 encoded audio
}

export interface AudioBlobData {
  roomId: string;
  audio: Buffer;
}

export interface SttIdCacheEntry {
  id: string;
  timestamp: number;
}

export interface HandlerContext {
  io: Server;
  roomService: RoomService;
  transcriptService: TranscriptService;
  sttManager: STTManager;
  translationService: TranslationService;
  azureTranslateService: AzureTranslateService;
  translationManagers: Map<string, TranslationManager>;
  sttIdCache: Map<string, Map<string, SttIdCacheEntry>>;
  audioChunksReceived: Map<string, number>;
  createTranslationManager: (roomCode: string, roomSettings: any) => Promise<void>;
  sendTranscriptHistory: (socket: Socket, roomId: string) => Promise<void>;
  sendTranslationHistory: (socket: Socket, roomId: string) => Promise<void>;
  translateHistoricalTexts: (roomCode: string) => Promise<void>;
}
