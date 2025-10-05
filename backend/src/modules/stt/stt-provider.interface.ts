import { EventEmitter } from 'events';

export interface TranscriptResult {
  text: string;
  confidence?: number;
  final: boolean;
}

export interface STTProviderConfig {
  [key: string]: any;
}

/**
 * Base interface for STT providers
 * Providers must extend EventEmitter and emit 'transcript', 'error', 'connected', 'disconnected' events
 */
export abstract class STTProvider extends EventEmitter {
  protected roomId: string;
  protected isConnected: boolean = false;

  constructor(roomId: string) {
    super();
    this.roomId = roomId;
  }

  /**
   * Connect to STT service
   */
  abstract connect(): Promise<void>;

  /**
   * Send audio data to STT service
   * @param audioData - Audio buffer (format depends on provider)
   */
  abstract sendAudio(audioData: Buffer): void;

  /**
   * End the current stream
   */
  abstract endStream(): void;

  /**
   * Disconnect from STT service
   */
  abstract disconnect(): void;

  /**
   * Check if provider is active and ready
   */
  abstract isActive(): boolean;

  /**
   * Get provider name
   */
  abstract getProviderName(): string;
}
