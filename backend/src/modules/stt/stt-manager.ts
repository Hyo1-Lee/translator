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
  isFinal?: boolean;
}

interface RoomContext {
  previousTranslations: string[];  // Previous 2-3 translation batches for context
  summary: string;                  // Running summary of the conversation
  lastBatchText: string;           // Last batch's Korean text
  targetLanguages: string[];       // Target languages for translation
  sentenceBuffer: string[];        // Buffer for accumulating sentences
  pendingPartialText: string;      // Current partial text (for context hint)
}

export class STTManager {
  private clients: Map<string, STTProvider> = new Map();
  private config: STTConfig;
  private translationService: TranslationService;
  private textBuffers: Map<string, string[]> = new Map();
  private bufferTimers: Map<string, NodeJS.Timeout> = new Map();
  private roomContexts: Map<string, RoomContext> = new Map();
  private roomTargetLanguages: Map<string, string[]> = new Map();
  private partialTextTimers: Map<string, NodeJS.Timeout> = new Map();
  private lastPartialText: Map<string, string> = new Map();
  private lastTranslatedText: Map<string, string> = new Map(); // Track last translated text to prevent duplicates

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
    customPrompt?: string,
    targetLanguages?: string[]
  ): Promise<void> {
    // Check if client already exists
    if (this.clients.has(roomId)) {
      console.log(`[STT][${roomId}] Client already exists, skipping creation`);
      return;
    }

    console.log(`[STT][${roomId}] Creating new STT client with provider: ${this.config.provider}`);

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
      lastBatchText: '',
      targetLanguages: targetLanguages || ['en'],
      sentenceBuffer: [],
      pendingPartialText: ''
    });
    // Store target languages for this room (default to English if not provided)
    this.roomTargetLanguages.set(roomId, targetLanguages && targetLanguages.length > 0 ? targetLanguages : ['en']);

    // Handle transcripts
    client.on('transcript', async (result: any) => {
      const transcriptData: TranscriptData = {
        roomId,
        text: result.text,
        timestamp: new Date(),
        confidence: result.confidence,
        isFinal: result.final
      };

      console.log(`[STT][${roomId}] Processing transcript (final: ${result.final}):`, result.text);

      // Always emit to frontend for IMMEDIATE display (no waiting!)
      onTranscript(transcriptData);

      // Only translate FINAL transcripts (skip partials to reduce load)
      if (result.final) {
        // Clear any pending partial text timer since we got a final result
        const partialTimer = this.partialTextTimers.get(roomId);
        if (partialTimer) {
          clearTimeout(partialTimer);
          this.partialTextTimers.delete(roomId);
        }
        this.lastPartialText.delete(roomId);

        // Check if this final text was already translated
        const lastTranslated = this.lastTranslatedText.get(roomId);
        if (lastTranslated && lastTranslated.trim() === result.text.trim()) {
          console.log(`[STT][${roomId}] ⏭️  Skipping translation - already processed`);
          return;
        }

        console.log(`[STT][${roomId}] 🚀 FINAL transcript - immediate translation`);
        // Mark as translated
        this.lastTranslatedText.set(roomId, result.text);
        // Immediately start translation (no buffering delay)
        this.bufferTextForTranslation(roomId, result.text, onTranslation);
      } else {
        // For partial transcripts, update context and set ultra-short timer
        const currentText = result.text;
        const context = this.roomContexts.get(roomId);
        if (context) {
          context.pendingPartialText = currentText;
        }

        // Clear existing timer
        const existingTimer = this.partialTextTimers.get(roomId);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        // Store current partial text
        this.lastPartialText.set(roomId, currentText);

        // Set ultra-short timer (800ms) to trigger translation if text stabilizes
        const timer = setTimeout(() => {
          const latestText = this.lastPartialText.get(roomId);
          if (latestText && latestText === currentText) {
            console.log(`[STT][${roomId}] ⚡ Translating stabilized partial transcript (800ms)`);
            this.bufferTextForTranslation(roomId, currentText, onTranslation);
            this.lastTranslatedText.set(roomId, currentText);
            this.lastPartialText.delete(roomId);
            this.partialTextTimers.delete(roomId);
          }
        }, 800); // Ultra-fast 800ms for partials

        this.partialTextTimers.set(roomId, timer);
        console.log(`[STT][${roomId}] ⏱️  Partial transcript timer set (800ms)`);
      }
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

    // For immediate response, flush buffer as soon as we have any content
    const fullText = buffer.join(' ');

    // Improved sentence detection for Korean text
    const sentences = fullText.match(/[^\.!\?]+[\.!\?]+/g) || [];
    const sentenceCount = sentences.length;
    const wordCount = fullText.split(/\s+/).filter(word => word.length > 0).length;
    const textLength = fullText.length;

    // HYPER-AGGRESSIVE translation trigger for instant response
    // 1. 1+ complete sentence (IMMEDIATE)
    // 2. 3+ words (IMMEDIATE) - reduced from 5
    // 3. 15+ characters (IMMEDIATE) - reduced from 20
    // 4. Anything else: 100ms delay (reduced from 500ms)
    if (sentenceCount >= 1 || wordCount >= 3 || textLength >= 15) {
      // Flush buffer IMMEDIATELY - no delay!
      console.log(`[Translation][${roomId}] 🚀 INSTANT flush: ${sentenceCount} sentences, ${wordCount} words, ${textLength} chars`);
      await this.flushBuffer(roomId, onTranslation);
    } else if (buffer.length > 0) {
      // Ultra-short timer for minimal content (100ms)
      const timer = setTimeout(async () => {
        console.log(`[Translation][${roomId}] ⚡ Flushing buffer by timer (100ms)`);
        await this.flushBuffer(roomId, onTranslation);
      }, 100); // HYPER-FAST 100ms response
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

      // Get target languages from context
      const targetLanguages = context.targetLanguages;

      // Translate to all target languages
      const translations: Record<string, string> = {};

      // Use English translation with context for the primary language
      if (targetLanguages.includes('en')) {
        const enTranslation = await this.translationService.translateWithContext(
          korean,
          contextualKorean,
          context.summary,
          'en'
        );
        if (enTranslation) {
          translations['en'] = enTranslation;
        }
      }

      // Translate to other languages in parallel
      const otherLanguages = targetLanguages.filter(lang => lang !== 'en');
      if (otherLanguages.length > 0) {
        const otherTranslations = await this.translationService.translateToMultipleLanguages(
          korean,
          otherLanguages
        );
        Object.assign(translations, otherTranslations);
      }

      // Use English as fallback if available
      const primaryTranslation = translations['en'] || Object.values(translations)[0];

      if (primaryTranslation) {
        console.log(`[Translation][${roomId}] Translated to ${Object.keys(translations).length} languages`);

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
          english: translations['en'] || '',  // Keep english for backwards compatibility
          translations,  // All translations
          batchId: `batch-${Date.now()}`,
          timestamp: new Date()
        });
      } else {
        console.error(`[Translation][${roomId}] All translations returned null`);
      }
    }
  }

  // Build contextual text with enhanced sliding window
  // Includes: [previous 2 translations] + [current text] + [hint from pending partial]
  private buildContextualText(currentText: string, context: RoomContext): string {
    const parts: string[] = [];

    // Add previous 2 translations for context
    const previousContext = context.previousTranslations.slice(-2).join(' ');
    if (previousContext) {
      parts.push(previousContext);
    }

    // Add current text (main content to translate)
    parts.push(currentText);

    // Add pending partial text as a hint for better flow (optional)
    if (context.pendingPartialText && context.pendingPartialText !== currentText) {
      // Only add if it's different from current text and not too long
      const partialHint = context.pendingPartialText.substring(0, 100);
      parts.push(`[다음: ${partialHint}...]`);
    }

    return parts.join(' ');
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

  // Audio chunk counters for debugging
  private audioChunksSent: Map<string, number> = new Map();

  // Send audio to STT
  sendAudio(roomId: string, audioData: Buffer): void {
    try {
      const client = this.clients.get(roomId);

      if (!client) {
        console.warn(`[STT][${roomId}] No client found for room`);
        return;
      }

      if (!client.isActive()) {
        console.warn(`[STT][${roomId}] Client is not active (provider: ${client.getProviderName()})`);
        return;
      }

      client.sendAudio(audioData);

      // Log audio forwarding
      const count = (this.audioChunksSent.get(roomId) || 0) + 1;
      this.audioChunksSent.set(roomId, count);
      if (count === 1 || count % 100 === 0) {
        console.log(`[STT][${roomId}] Forwarded ${count} audio chunks to ${client.getProviderName()} (${audioData.length} bytes)`);
      }
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
      this.roomContexts.delete(roomId);
      this.roomTargetLanguages.delete(roomId);
      this.audioChunksSent.delete(roomId);
      this.lastPartialText.delete(roomId);
      this.lastTranslatedText.delete(roomId);

      // Clear buffer timer
      const timer = this.bufferTimers.get(roomId);
      if (timer) {
        clearTimeout(timer);
        this.bufferTimers.delete(roomId);
      }

      // Clear partial text timer
      const partialTimer = this.partialTextTimers.get(roomId);
      if (partialTimer) {
        clearTimeout(partialTimer);
        this.partialTextTimers.delete(roomId);
      }
    }
  }

  // Close client (alias for removeClient)
  closeClient(roomId: string): void {
    this.removeClient(roomId);
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

  // Get all active room IDs
  getActiveRoomIds(): string[] {
    return Array.from(this.clients.keys());
  }

  // Clean up orphaned clients (clients for rooms that no longer exist)
  cleanupOrphanedClients(activeRoomCodes: string[]): void {
    const activeSet = new Set(activeRoomCodes);
    const clientRoomIds = Array.from(this.clients.keys());

    for (const roomId of clientRoomIds) {
      if (!activeSet.has(roomId)) {
        console.log(`[STT] Removing orphaned client for room ${roomId}`);
        this.removeClient(roomId);
      }
    }
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