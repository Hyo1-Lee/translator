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

interface RoomContext {
  previousTranslations: string[];  // Previous 2-3 translation batches for context
  summary: string;                  // Running summary of the conversation
  lastBatchText: string;           // Last batch's Korean text
}

export class STTManager {
  private clients: Map<string, RTZRClient> = new Map();
  private config: STTConfig;
  private translationService: TranslationService;
  private textBuffers: Map<string, string[]> = new Map();
  private bufferTimers: Map<string, NodeJS.Timeout> = new Map();
  private roomContexts: Map<string, RoomContext> = new Map();

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

    // Initialize text buffer and context for this room
    this.textBuffers.set(roomId, []);
    this.roomContexts.set(roomId, {
      previousTranslations: [],
      summary: '',
      lastBatchText: ''
    });

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

    // Check if buffer is ready for translation
    const fullText = buffer.join(' ');

    // Improved sentence detection for Korean text
    const sentences = fullText.match(/[^\.!\?]+[\.!\?]+/g) || [];
    const sentenceCount = sentences.length;
    const wordCount = fullText.split(/\s+/).filter(word => word.length > 0).length;
    const textLength = fullText.length;

    // Flush conditions:
    // 1. 3+ sentences (lowered from 4 for faster response)
    // 2. 30+ words (for long single sentences)
    // 3. 150+ characters (for continuous speech without clear sentence endings)
    if (sentenceCount >= 3 || wordCount >= 30 || textLength >= 150) {
      // Flush buffer immediately when we have enough content
      await this.flushBuffer(roomId, onTranslation);
    } else if (buffer.length > 0) {
      // Set timer to flush buffer after 3 seconds (reduced from 5 for faster response)
      const timer = setTimeout(async () => {
        await this.flushBuffer(roomId, onTranslation);
      }, 3000); // Reduced from 5000ms for faster response
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

    // Translate with context
    if (onTranslation) {
      const context = this.roomContexts.get(roomId);
      if (!context) return;

      // Build contextual prompt with previous translations
      const contextualKorean = this.buildContextualText(korean, context);

      const translation = await this.translationService.translateWithContext(
        korean,
        contextualKorean,
        context.summary,
        'en'
      );

      if (translation) {
        // Update context for next translation
        context.previousTranslations.push(korean);
        if (context.previousTranslations.length > 3) {
          context.previousTranslations.shift(); // Keep only last 3 batches
        }
        context.lastBatchText = korean;

        // Update summary periodically (every 5 batches)
        if (context.previousTranslations.length % 5 === 0) {
          await this.updateConversationSummary(roomId);
        }

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

  // Build contextual text with sliding window
  private buildContextualText(currentText: string, context: RoomContext): string {
    const previousContext = context.previousTranslations.slice(-2).join(' ');
    return previousContext ? `${previousContext} ${currentText}` : currentText;
  }

  // Update conversation summary
  private async updateConversationSummary(roomId: string): Promise<void> {
    const context = this.roomContexts.get(roomId);
    if (!context) return;

    const recentText = context.previousTranslations.slice(-5).join(' ');
    if (recentText) {
      // Generate summary using LLM
      const summary = await this.translationService.generateSummary(recentText, context.summary);
      if (summary) {
        context.summary = summary;
        console.log(`[STT] Updated summary for room ${roomId}`);
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