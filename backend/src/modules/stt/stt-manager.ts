import { RTZRClient } from './rtzr-client';
import { OpenAIRealtimeClient } from './openai-realtime-client';
import { OpenAIWhisperClient } from './openai-whisper-client';
import { STTProvider } from './stt-provider.interface';
import { TranslationService } from '../translation/translation-service';
import { optimizeCustomPromptWithGPT } from './prompts/prompt-templates';

type STTProviderType = 'rtzr' | 'openai' | 'openai-whisper';

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

interface OpenAIWhisperConfig {
  apiKey: string;
  model?: string;
  language?: string;
  prompt?: string;
  temperature?: number;
}

interface STTConfig {
  provider: STTProviderType;
  rtzr?: RTZRConfig;
  openai?: OpenAIRealtimeConfig;
  whisper?: OpenAIWhisperConfig;
  defaultPromptTemplate?: string; // 'church', 'medical', 'legal', 'business', 'tech', 'education', 'general'
}

interface TranscriptData {
  roomId: string;
  text: string;
  timestamp: Date;
  confidence?: number;
  isFinal?: boolean;
}

export class STTManager {
  private clients: Map<string, STTProvider> = new Map();
  private config: STTConfig;
  private translationService: TranslationService;

  constructor(config: STTConfig, translationService: TranslationService) {
    this.config = config;
    this.translationService = translationService;
  }

  // Create STT client for a room
  async createClient(
    roomId: string,
    onTranscript: (data: TranscriptData) => void,
    _onTranslation?: (data: any) => void,
    promptTemplate?: string,
    customPrompt?: string,
    _targetLanguages?: string[]
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
    } else if (provider === 'openai-whisper') {
      if (!this.config.whisper) {
        throw new Error('OpenAI Whisper configuration is missing');
      }

      client = new OpenAIWhisperClient(roomId, this.config.whisper);
    } else {
      if (!this.config.rtzr) {
        throw new Error('RTZR configuration is missing');
      }

      client = new RTZRClient(roomId, this.config.rtzr);
    }

    // Handle transcripts - ULTRA SIMPLE REAL-TIME
    client.on('transcript', async (result: any) => {
      // Just emit the text directly - no sentence splitting!
      onTranscript({
        roomId,
        text: result.text || '',
        timestamp: new Date(),
        confidence: result.confidence,
        isFinal: result.final
      });
    });

    // Handle errors
    client.on('error', (error) => {
      console.error(`[STT][${roomId}] Error:`, error);
    });

    // Connect to service
    await client.connect();

    this.clients.set(roomId, client);
  }

  // Send audio to STT - FAST PATH
  sendAudio(roomId: string, audioData: Buffer): void {
    const client = this.clients.get(roomId);
    if (!client) {
      console.warn(`[STT][${roomId}] ⚠️  No client found for room`);
      return;
    }

    if (!client.isActive()) {
      console.warn(`[STT][${roomId}] ⚠️  Client exists but is not active`);
      return;
    }

    client.sendAudio(audioData);
  }

  // Remove client
  removeClient(roomId: string): void {
    const client = this.clients.get(roomId);
    if (client) {
      client.disconnect();
      this.clients.delete(roomId);
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

}