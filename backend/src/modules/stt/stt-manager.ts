import { DeepgramClient } from './deepgram-client';
import { STTProvider } from './stt-provider.interface';

interface DeepgramConfig {
  apiKey: string;
  model?: 'nova-3' | 'nova-2' | 'enhanced' | 'general';
  tier?: 'enhanced' | 'base';
  version?: string;
  language?: string;
  smartFormat?: boolean;
  punctuate?: boolean;
  diarize?: boolean;
}

interface STTConfig {
  deepgram: DeepgramConfig;
  defaultPromptTemplate?: string;
}

interface TranscriptData {
  roomId: string;
  text: string;
  timestamp: Date;
  confidence?: number;
  isFinal?: boolean;
}

/**
 * Simplified STT Manager - Deepgram Only
 *
 * Removed: OpenAI, RTZR, Translation services
 * Optimized: Direct Deepgram integration for low latency
 */
export class STTManager {
  private clients: Map<string, STTProvider> = new Map();
  private config: STTConfig;

  constructor(config: STTConfig) {
    this.config = config;
    console.log(`[STT Manager] 🚀 Initialized with Deepgram ${config.deepgram.model || 'nova-3'}`);
  }

  /**
   * Create STT client for a room (Deepgram only)
   */
  async createClient(
    roomId: string,
    onTranscript: (data: TranscriptData) => void,
    _onTranslation?: (data: any) => void, // Kept for API compatibility, unused
    promptTemplate?: string,
    _customPrompt?: string, // Unused - Deepgram uses keywords
    _targetLanguages?: string[] // Unused
  ): Promise<void> {
    // Check if client already exists
    if (this.clients.has(roomId)) {
      console.log(`[STT Manager][${roomId}] ♻️  Client already exists, reusing`);
      return;
    }

    console.log(`[STT Manager][${roomId}] 🔨 Creating Deepgram client with template: ${promptTemplate || 'general'}...`);

    // Pass promptTemplate to DeepgramClient for keyword loading
    const client = new DeepgramClient(roomId, {
      ...this.config.deepgram,
      promptTemplate: promptTemplate || this.config.defaultPromptTemplate || 'general',
    });

    // Handle transcripts - ULTRA FAST PATH
    client.on('transcript', (result: any) => {
      const transcriptData = {
        roomId,
        text: result.text || '',
        timestamp: new Date(),
        confidence: result.confidence,
        isFinal: result.final
      };

      // Log transcripts for debugging
      if (transcriptData.isFinal) {
        console.log(`[STT Manager][${roomId}] ✅ FINAL: "${transcriptData.text}" (confidence: ${(transcriptData.confidence * 100).toFixed(1)}%)`);
      } else {
        console.log(`[STT Manager][${roomId}] ⏳ INTERIM: "${transcriptData.text}"`);
      }

      onTranscript(transcriptData);
    });

    // Handle errors
    client.on('error', (error) => {
      console.error(`[STT Manager][${roomId}] ❌ Error:`, error);
    });

    // Handle disconnection
    client.on('disconnected', () => {
      console.log(`[STT Manager][${roomId}] 🔴 Disconnected`);
    });

    // Connect to Deepgram
    try {
      await client.connect();
      this.clients.set(roomId, client);
      console.log(`[STT Manager][${roomId}] ✅ Client created and connected`);
    } catch (error) {
      console.error(`[STT Manager][${roomId}] ❌ Failed to create client:`, error);
      throw error;
    }
  }

  /**
   * Send audio to STT - OPTIMIZED FAST PATH
   */
  private sendCount: Map<string, number> = new Map();

  sendAudio(roomId: string, audioData: Buffer): void {
    const client = this.clients.get(roomId);

    if (!client) {
      const count = this.sendCount.get(roomId) || 0;
      if (count === 0) {
        console.error(`[STT Manager][${roomId}] ❌ No client found for room`);
      }
      this.sendCount.set(roomId, count + 1);
      return;
    }

    if (!client.isActive()) {
      const count = this.sendCount.get(roomId) || 0;
      if (count === 0) {
        console.error(`[STT Manager][${roomId}] ❌ Client is not active`);
      }
      this.sendCount.set(roomId, count + 1);
      return;
    }

    // Direct send - no buffering, no preprocessing
    client.sendAudio(audioData);
  }

  /**
   * Remove client
   */
  removeClient(roomId: string): void {
    const client = this.clients.get(roomId);
    if (client) {
      console.log(`[STT Manager][${roomId}] 🧹 Removing client...`);
      client.disconnect();
      this.clients.delete(roomId);
    }
  }

  /**
   * Close client (alias for removeClient)
   */
  closeClient(roomId: string): void {
    this.removeClient(roomId);
  }

  /**
   * Get active client count
   */
  getActiveClientCount(): number {
    return this.clients.size;
  }

  /**
   * Check if room has active client
   */
  hasActiveClient(roomId: string): boolean {
    const client = this.clients.get(roomId);
    return client ? client.isActive() : false;
  }

  /**
   * Get all active room IDs
   */
  getActiveRoomIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Clean up orphaned clients
   */
  cleanupOrphanedClients(activeRoomCodes: string[]): void {
    const activeSet = new Set(activeRoomCodes);
    const clientRoomIds = Array.from(this.clients.keys());

    for (const roomId of clientRoomIds) {
      if (!activeSet.has(roomId)) {
        console.log(`[STT Manager][${roomId}] 🧹 Cleaning up orphaned client`);
        this.removeClient(roomId);
      }
    }
  }
}
