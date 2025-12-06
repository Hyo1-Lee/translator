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
 */
export class STTManager {
  private clients: Map<string, STTProvider> = new Map();
  private config: STTConfig;

  constructor(config: STTConfig) {
    this.config = config;
  }

  /**
   * Create STT client for a room (Deepgram only)
   */
  async createClient(
    roomId: string,
    onTranscript: (data: TranscriptData) => void,
    _onTranslation?: (data: any) => void,
    promptTemplate?: string,
    _customPrompt?: string,
    _targetLanguages?: string[]
  ): Promise<void> {
    if (this.clients.has(roomId)) {
      return;
    }

    const client = new DeepgramClient(roomId, {
      ...this.config.deepgram,
      promptTemplate: promptTemplate || this.config.defaultPromptTemplate || 'general',
    });

    client.on('transcript', (result: any) => {
      const transcriptData = {
        roomId,
        text: result.text || '',
        timestamp: new Date(),
        confidence: result.confidence,
        isFinal: result.final
      };

      onTranscript(transcriptData);
    });

    client.on('error', (error) => {
      console.error(`[STT Manager] Error:`, error);
    });

    client.on('disconnected', () => {
      // Disconnected
    });

    try {
      await client.connect();
      this.clients.set(roomId, client);
    } catch (error) {
      console.error(`[STT Manager] Failed to create client:`, error);
      throw error;
    }
  }

  /**
   * Send audio to STT
   */
  private sendCount: Map<string, number> = new Map();

  sendAudio(roomId: string, audioData: Buffer): void {
    const client = this.clients.get(roomId);

    if (!client) {
      return;
    }

    if (!client.isActive()) {
      return;
    }

    client.sendAudio(audioData);
  }

  /**
   * Remove client
   */
  removeClient(roomId: string): void {
    const client = this.clients.get(roomId);
    if (client) {
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
        this.removeClient(roomId);
      }
    }
  }
}
