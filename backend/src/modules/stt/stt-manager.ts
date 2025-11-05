import { RTZRClient } from './rtzr-client';
import { OpenAIRealtimeClient } from './openai-realtime-client';
import { STTProvider } from './stt-provider.interface';
import { TranslationService } from '../translation/translation-service';
import { optimizeCustomPromptWithGPT } from './prompts/prompt-templates';

type STTProviderType = 'rtzr' | 'openai';

interface RTZRConfig {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
}

interface OpenAIRealtimeConfig {
  apiKey: string;
  model?: string;
  voice?: string;
  temperature?: number;
  maxOutputTokens?: number | 'inf';
  vadThreshold?: number;
  vadSilenceDuration?: number;
  prefixPadding?: number;
  turnDetection?: 'server_vad' | 'disabled';
}

interface STTConfig {
  provider: STTProviderType;
  rtzr?: RTZRConfig;
  openai?: OpenAIRealtimeConfig;
  defaultPromptTemplate?: string; // 'church', 'medical', 'legal', 'business', 'tech', 'education', 'general'
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
  private clients: Map<string, STTProvider> = new Map();
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
    onTranslation?: (data: any) => void,
    promptTemplate?: string,
    customPrompt?: string
  ): Promise<void> {
    // Check if client already exists
    if (this.clients.has(roomId)) {
      return;
    }

    // Determine which provider to use
    const provider = this.config.provider;

    // Create appropriate client based on provider
    let client: STTProvider;

    if (provider === 'openai') {
      if (!this.config.openai) {
        throw new Error('OpenAI configuration is missing');
      }

      const template = promptTemplate || this.config.defaultPromptTemplate || 'general';

      // If custom prompt is provided and template is 'custom', optimize it with GPT
      let optimizedPrompt = customPrompt;
      if (template === 'custom' && customPrompt && this.config.openai.apiKey) {
        try {
          console.log(`[STT][${roomId}] Optimizing custom prompt with GPT...`);
          const optimizedTemplate = await optimizeCustomPromptWithGPT(customPrompt, this.config.openai.apiKey);
          optimizedPrompt = optimizedTemplate.instructions;
          console.log(`[STT][${roomId}] Custom prompt optimized successfully`);
        } catch (error) {
          console.error(`[STT][${roomId}] Failed to optimize custom prompt, using original:`, error);
        }
      }

      client = new OpenAIRealtimeClient(roomId, this.config.openai, template, optimizedPrompt);
    } else {
      if (!this.config.rtzr) {
        throw new Error('RTZR configuration is missing');
      }

      client = new RTZRClient(roomId, this.config.rtzr);
    }

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

    // Connect to service
    await client.connect();

    this.clients.set(roomId, client);
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
    // 1. 2+ sentences (lowered for faster response)
    // 2. 20+ words (for long single sentences)
    // 3. 100+ characters (for continuous speech without clear sentence endings)
    if (sentenceCount >= 2 || wordCount >= 20 || textLength >= 100) {
      // Flush buffer immediately when we have enough content
      await this.flushBuffer(roomId, onTranslation);
    } else if (buffer.length > 0) {
      // Set timer to flush buffer after 2 seconds (reduced for faster response)
      const timer = setTimeout(async () => {
        await this.flushBuffer(roomId, onTranslation);
      }, 2000); // Reduced from 3000ms for faster response
      this.bufferTimers.set(roomId, timer);
    }
  }

  // Flush buffer and translate
  private async flushBuffer(
    roomId: string,
    onTranslation?: (data: any) => void
  ): Promise<void> {
    const buffer = this.textBuffers.get(roomId);
    if (!buffer || buffer.length === 0) {
      return;
    }

    // Create batch for translation
    const korean = buffer.join(' ');
    console.log(`[Translation][${roomId}] Korean text: "${korean}"`);
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
      if (!context) {
        console.error(`[Translation][${roomId}] Context not found!`);
        return;
      }

      // Build contextual prompt with previous translations
      const contextualKorean = this.buildContextualText(korean, context);

      const translation = await this.translationService.translateWithContext(
        korean,
        contextualKorean,
        context.summary,
        'en'
      );

      if (translation) {
        console.log(`[Translation][${roomId}] English: "${translation}"`);
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
      } else {
        console.error(`[Translation][${roomId}] Translation returned null`);
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
      }
    }
  }

  // Send audio to STT
  sendAudio(roomId: string, audioData: Buffer): void {
    try {
      const client = this.clients.get(roomId);

      if (!client) {
        return;
      }

      if (!client.isActive()) {
        return;
      }

      client.sendAudio(audioData);
    } catch (error) {
      console.error(`[STT][${roomId}] Error sending audio:`, error);
      if (error instanceof Error) {
        console.error(`[STT][${roomId}] Error details: ${error.message}`);
      }
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

  // Get current provider for a room
  getProvider(roomId: string): string | null {
    const client = this.clients.get(roomId);
    return client ? client.getProviderName() : null;
  }

  // Update OpenAI prompt template for better accuracy (only for OpenAI clients)
  updateOpenAIPromptTemplate(roomId: string, templateName: string): void {
    const client = this.clients.get(roomId);
    if (client && client instanceof OpenAIRealtimeClient) {
      client.setPromptTemplate(templateName);
    }
  }

  // Get metrics for a specific room (OpenAI only)
  getClientMetrics(roomId: string): any {
    const client = this.clients.get(roomId);
    if (client && client instanceof OpenAIRealtimeClient) {
      return client.getMetrics();
    }
    return null;
  }
}