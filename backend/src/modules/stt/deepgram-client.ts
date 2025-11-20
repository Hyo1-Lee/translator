import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { STTProvider } from './stt-provider.interface';
import { getKeywords, toKeyterms, toKeywordsWithIntensifiers } from './keywords-config';

/**
 * Deepgram Model Types
 */
type DeepgramModel = 'nova-3' | 'enhanced';

/**
 * Deepgram Configuration
 */
interface DeepgramConfig {
  apiKey: string;
  model?: DeepgramModel;
  language?: string;
  smartFormat?: boolean;
  punctuate?: boolean;
  diarize?: boolean;
  interimResults?: boolean;
}

/**
 * PRODUCTION-READY Deepgram Client for Real-Time Korean Transcription
 *
 * Key Features:
 * - KeepAlive to maintain connection during silence
 * - Automatic reconnection with exponential backoff
 * - Proper error handling and logging
 * - <300ms latency target
 *
 * Based on Official Deepgram Documentation (2025)
 */
export class DeepgramClient extends STTProvider {
  // Configuration
  private config: DeepgramConfig;
  private templateName: string;

  // Deepgram client and connection
  private client: any;
  private connection: any;
  private isReady: boolean = false;

  // KeepAlive mechanism - CRITICAL for maintaining connection
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private readonly KEEPALIVE_INTERVAL = 3000; // 3 seconds (official recommendation)

  // Reconnection logic
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect: boolean = true;

  // Performance metrics (lightweight)
  private metrics = {
    transcriptsReceived: 0,
    audioBytesSent: 0,
    errors: 0,
    connectionAttempts: 0,
  };

  constructor(
    roomId: string,
    config: DeepgramConfig,
    templateName: string = 'general'
  ) {
    super(roomId);

    this.config = {
      model: 'nova-3',
      language: 'ko',
      smartFormat: true,
      punctuate: true,
      diarize: false,
      interimResults: true,
      ...config,
    };

    this.templateName = templateName;

    console.log(`[Deepgram][${roomId}] 🚀 Init: ${this.config.model}, template: ${templateName}`);
  }

  /**
   * Connect to Deepgram Live Streaming API
   */
  async connect(): Promise<void> {
    try {
      this.metrics.connectionAttempts++;
      console.log(`[Deepgram][${this.roomId}] 🔌 Connecting... (attempt #${this.metrics.connectionAttempts})`);

      // Create Deepgram client
      this.client = createClient(this.config.apiKey);

      // Build connection options based on model
      const options = this.buildConnectionOptions();

      // Create live transcription connection
      this.connection = this.client.listen.live(options);

      // Setup event handlers BEFORE waiting for ready
      this.setupEventHandlers();

      // Wait for connection to be ready
      await this.waitForReady(10000);

      // Start KeepAlive mechanism - CRITICAL
      this.startKeepAlive();

      console.log(`[Deepgram][${this.roomId}] ✅ Connected successfully with KeepAlive`);
    } catch (error) {
      console.error(`[Deepgram][${this.roomId}] ❌ Connection failed:`, error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Build connection options - OPTIMIZED
   */
  private buildConnectionOptions(): any {
    const keywords = getKeywords(this.templateName);
    console.log(`[Deepgram][${this.roomId}] 📋 Template: ${this.templateName}, keywords loaded: ${keywords.length}`);

    // CRITICAL: For containerized audio (WebM/Opus), DO NOT set encoding/sample_rate
    // Deepgram will auto-detect from container header!
    const baseOptions: any = {
      language: this.config.language,
      smart_format: this.config.smartFormat,
      punctuate: this.config.punctuate,
      diarize: this.config.diarize,
      interim_results: this.config.interimResults,
      // NO encoding, NO sample_rate for WebM!
      // Deepgram auto-detects from container
      // Optimize for low latency
      endpointing: 300, // 300ms silence to finalize
      vad_events: true, // Voice activity detection
    };

    console.log(`[Deepgram][${this.roomId}] 🎙️  Audio config: WebM containerized (auto-detect)`);

    if (this.config.model === 'nova-3') {
      const keyterms = toKeyterms(keywords);
      console.log(`[Deepgram][${this.roomId}] 🎯 Nova-3 with ${keyterms.length} keyterms`);

      return {
        ...baseOptions,
        model: 'nova-3',
        keyterm: keyterms,
      };
    } else {
      const keywordsWithIntensifiers = toKeywordsWithIntensifiers(keywords);
      console.log(`[Deepgram][${this.roomId}] 🎯 Enhanced with ${keywordsWithIntensifiers.length} keywords`);

      return {
        ...baseOptions,
        model: 'general',
        tier: 'enhanced',
        keywords: keywordsWithIntensifiers,
      };
    }
  }

  /**
   * Setup Deepgram event handlers
   */
  private setupEventHandlers(): void {
    if (!this.connection) return;

    this.connection.on(LiveTranscriptionEvents.Open, () => {
      console.log(`[Deepgram][${this.roomId}] 🟢 Connection opened`);
      this.isReady = true;
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');
    });

    this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      try {
        this.handleTranscript(data);
      } catch (error) {
        console.error(`[Deepgram][${this.roomId}] ❌ Transcript error:`, error);
        this.metrics.errors++;
      }
    });

    this.connection.on(LiveTranscriptionEvents.Close, () => {
      console.log(`[Deepgram][${this.roomId}] 🔴 Connection closed`);
      this.handleDisconnection();
    });

    this.connection.on(LiveTranscriptionEvents.Error, (error: any) => {
      console.error(`[Deepgram][${this.roomId}] ❌ Error:`, error);
      this.metrics.errors++;
      this.emit('error', error);
    });

    this.connection.on(LiveTranscriptionEvents.Metadata, (metadata: any) => {
      // Log first metadata for debugging
      if (this.metrics.transcriptsReceived === 0) {
        console.log(`[Deepgram][${this.roomId}] 📊 Metadata:`, JSON.stringify(metadata, null, 2));
      }
    });
  }

  /**
   * Start KeepAlive mechanism - CRITICAL for maintaining connection
   *
   * From official docs: "Send a KeepAlive message every 3-5 seconds
   * to prevent the 10-second timeout that triggers a NET-0001 error."
   */
  private startKeepAlive(): void {
    // Clear any existing interval
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    // Start new KeepAlive interval
    this.keepAliveInterval = setInterval(() => {
      if (this.connection && this.isConnected) {
        try {
          this.connection.keepAlive();
          // Only log occasionally to reduce spam
          if (this.metrics.transcriptsReceived % 20 === 0) {
            console.log(`[Deepgram][${this.roomId}] 💓 KeepAlive sent`);
          }
        } catch (error) {
          console.error(`[Deepgram][${this.roomId}] ❌ KeepAlive failed:`, error);
        }
      }
    }, this.KEEPALIVE_INTERVAL);

    console.log(`[Deepgram][${this.roomId}] 💓 KeepAlive started (${this.KEEPALIVE_INTERVAL}ms interval)`);
  }

  /**
   * Stop KeepAlive mechanism
   */
  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      console.log(`[Deepgram][${this.roomId}] 💔 KeepAlive stopped`);
    }
  }

  /**
   * Handle incoming transcript - FAST PATH
   */
  private handleTranscript(data: any): void {
    const channel = data.channel;
    if (!channel?.alternatives?.[0]) return;

    const alternative = channel.alternatives[0];
    const transcript = alternative.transcript?.trim();

    if (!transcript) return;

    const isFinal = data.is_final || false;

    // Emit immediately
    this.emit('transcript', {
      text: transcript,
      confidence: alternative.confidence || 0,
      final: isFinal,
    });

    this.metrics.transcriptsReceived++;

    // Log only final for debugging
    if (isFinal) {
      console.log(`[Deepgram][${this.roomId}] 📝 Final: "${transcript}" (conf: ${(alternative.confidence * 100).toFixed(1)}%)`);
    }
  }

  /**
   * Send audio data to Deepgram - ULTRA FAST PATH
   * NO preprocessing, NO buffering, DIRECT send
   */
  sendAudio(audioData: Buffer): void {
    if (!this.isReady || !this.connection) {
      // Silent fail during initial connection
      return;
    }

    try {
      // DIRECT send - no processing
      this.connection.send(audioData);
      this.metrics.audioBytesSent += audioData.length;

      // Log first audio chunk for debugging
      if (this.metrics.audioBytesSent === audioData.length) {
        console.log(`[Deepgram][${this.roomId}] 🎤 First audio chunk sent: ${audioData.length} bytes`);
      }
    } catch (error) {
      this.metrics.errors++;
      console.error(`[Deepgram][${this.roomId}] ❌ Audio send error:`, error);
    }
  }

  /**
   * End audio stream (optional, signals end of audio)
   */
  endStream(): void {
    if (this.connection) {
      try {
        this.connection.finish();
        console.log(`[Deepgram][${this.roomId}] 🏁 Stream ended`);
      } catch (error) {
        console.error(`[Deepgram][${this.roomId}] ❌ Failed to end stream:`, error);
      }
    }
  }

  /**
   * Disconnect from Deepgram - CLEAN
   */
  disconnect(): void {
    console.log(`[Deepgram][${this.roomId}] 🔌 Disconnecting...`);

    // Stop reconnection attempts
    this.shouldReconnect = false;

    // Stop KeepAlive
    this.stopKeepAlive();

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close connection
    if (this.connection) {
      try {
        this.connection.finish();
      } catch (error) {
        // Ignore disconnect errors
      }
      this.connection = null;
    }

    this.isReady = false;
    this.isConnected = false;

    console.log(`[Deepgram][${this.roomId}] 📊 Final stats: ${this.metrics.transcriptsReceived} transcripts, ${this.metrics.audioBytesSent} bytes, ${this.metrics.errors} errors`);

    this.emit('disconnected');
  }

  /**
   * Handle disconnection - AUTO RECONNECT
   */
  private handleDisconnection(): void {
    this.isReady = false;
    this.isConnected = false;

    // Stop KeepAlive
    this.stopKeepAlive();

    this.emit('disconnected');

    // Only reconnect if explicitly allowed
    if (!this.shouldReconnect) {
      console.log(`[Deepgram][${this.roomId}] ⏹️  Reconnection disabled`);
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 10000);

      console.log(`[Deepgram][${this.roomId}] 🔄 Reconnecting in ${delay}ms (attempt #${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      this.reconnectTimer = setTimeout(() => {
        this.connect().catch((error) => {
          console.error(`[Deepgram][${this.roomId}] ❌ Reconnect failed:`, error);
        });
      }, delay);
    } else {
      console.error(`[Deepgram][${this.roomId}] ❌ Max reconnect attempts reached`);
      this.emit('error', new Error('Max reconnect attempts reached'));
    }
  }

  /**
   * Wait for connection to be ready
   */
  private waitForReady(timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);

      const checkReady = () => {
        if (this.isReady) {
          clearTimeout(timeoutId);
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };

      checkReady();
    });
  }

  /**
   * Check if client is active and ready
   */
  isActive(): boolean {
    return this.isConnected && this.isReady;
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return `deepgram-${this.config.model}`;
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      isReady: this.isReady,
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      hasKeepAlive: this.keepAliveInterval !== null,
    };
  }
}
