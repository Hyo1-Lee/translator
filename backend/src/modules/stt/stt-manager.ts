import { RTZRClient } from './rtzr-client';
import { TranslationService } from '../translation/translation-service';

interface STTConfig {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
}

interface TranscriptData {
  roomId: string;
  text: string;
  timestamp: Date;
  confidence?: number;
}

export class STTManager {
  private clients: Map<string, RTZRClient> = new Map();
  private config: STTConfig;
  private translationService: TranslationService;
  private textBuffers: Map<string, string[]> = new Map();
  private bufferTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: STTConfig, translationService: TranslationService) {
    this.config = config;
    this.translationService = translationService;
  }

  // Create STT client for a room
  async createClient(
    roomId: string,
    onTranscript: (data: TranscriptData) => void,
    onTranslation?: (data: any) => void
  ): Promise<void> {
    // Check if client already exists
    if (this.clients.has(roomId)) {
      console.log(`[STT] Client already exists for room ${roomId}`);
      return;
    }

    const client = new RTZRClient(roomId, this.config);

    // Initialize text buffer for this room
    this.textBuffers.set(roomId, []);

    // Handle transcripts
    client.on('transcript', async (result: any) => {
      const transcriptData: TranscriptData = {
        roomId,
        text: result.text,
        timestamp: new Date(),
        confidence: result.confidence
      };

      // Emit STT result
      onTranscript(transcriptData);

      // Buffer text for translation
      this.bufferTextForTranslation(roomId, result.text, onTranslation);
    });

    // Handle errors
    client.on('error', (error) => {
      console.error(`[STT][${roomId}] Error:`, error);
    });

    // Connect to WebSocket
    await client.connect();

    this.clients.set(roomId, client);
    console.log(`[STT] Client created for room ${roomId}`);
  }

  // Buffer text and trigger translation when ready
  private async bufferTextForTranslation(
    roomId: string,
    text: string,
    onTranslation?: (data: any) => void
  ): Promise<void> {
    const buffer = this.textBuffers.get(roomId);
    if (!buffer) return;

    // Add text to buffer
    buffer.push(text);

    // Clear existing timer
    const existingTimer = this.bufferTimers.get(roomId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Check if buffer is ready for translation (4-5 sentences)
    const fullText = buffer.join(' ');
    const sentenceCount = fullText.split(/[.!?]/).filter(s => s.trim()).length;

    if (sentenceCount >= 4) {
      // Flush buffer immediately when we have enough sentences
      await this.flushBuffer(roomId, onTranslation);
    } else if (buffer.length > 0) {
      // Set timer to flush buffer after 5 seconds of no new input
      const timer = setTimeout(async () => {
        await this.flushBuffer(roomId, onTranslation);
      }, 5000);
      this.bufferTimers.set(roomId, timer);
    }
  }

  // Flush buffer and translate
  private async flushBuffer(
    roomId: string,
    onTranslation?: (data: any) => void
  ): Promise<void> {
    const buffer = this.textBuffers.get(roomId);
    if (!buffer || buffer.length === 0) return;

    // Create batch for translation
    const korean = buffer.join(' ');
    this.textBuffers.set(roomId, []); // Clear buffer

    // Clear timer
    const timer = this.bufferTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.bufferTimers.delete(roomId);
    }

    // Translate
    if (onTranslation) {
      const translation = await this.translationService.translate(korean, 'en');
      if (translation) {
        onTranslation({
          roomId,
          korean,
          english: translation,
          batchId: `batch-${Date.now()}`,
          timestamp: new Date()
        });
      }
    }
  }

  // Send audio to STT
  sendAudio(roomId: string, audioData: Buffer): void {
    const client = this.clients.get(roomId);
    if (client && client.isActive()) {
      client.sendAudio(audioData);
    }
  }

  // Remove client
  removeClient(roomId: string): void {
    const client = this.clients.get(roomId);
    if (client) {
      client.disconnect();
      this.clients.delete(roomId);
      this.textBuffers.delete(roomId);

      // Clear timer
      const timer = this.bufferTimers.get(roomId);
      if (timer) {
        clearTimeout(timer);
        this.bufferTimers.delete(roomId);
      }

      console.log(`[STT] Client removed for room ${roomId}`);
    }
  }

  // Get active client count
  getActiveClientCount(): number {
    return this.clients.size;
  }

  // Check if room has active client
  hasActiveClient(roomId: string): boolean {
    const client = this.clients.get(roomId);
    return client ? client.isActive() : false;
  }
}