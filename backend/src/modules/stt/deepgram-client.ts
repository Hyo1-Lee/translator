import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { STTProvider } from './stt-provider.interface';

/**
 * Deepgram Configuration
 */
interface DeepgramConfig {
  apiKey: string;
  model?: 'nova-3' | 'nova-2' | 'enhanced' | 'general';
  tier?: 'enhanced' | 'base';
  version?: string;
  language?: string;
  smartFormat?: boolean;
  punctuate?: boolean;
  interimResults?: boolean;
  promptTemplate?: string;
}

/**
 * SegmentAggregator - Deepgram이 빠르게 연속 전송하는 is_final 세그먼트를
 * 짧은 윈도우(300ms)로 합쳐서 하나의 세그먼트로 전달
 */
class SegmentAggregator {
  private buffer: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastConfidence: number = 0;
  private readonly WINDOW_MS = 300;
  private onFlush: (text: string, confidence: number) => void;

  constructor(onFlush: (text: string, confidence: number) => void) {
    this.onFlush = onFlush;
  }

  add(text: string, confidence: number): void {
    this.buffer.push(text);
    this.lastConfidence = confidence;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.flush();
    }, this.WINDOW_MS);
  }

  flush(): void {
    if (this.buffer.length === 0) return;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const combined = this.buffer.join(' ').trim();
    this.buffer = [];

    if (combined.length > 0) {
      this.onFlush(combined, this.lastConfidence);
    }
  }

  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = [];
  }
}

/**
 * Deepgram Client - Nova-3 고정, 커스텀 버퍼링 제거, SegmentAggregator 사용
 */
export class DeepgramClient extends STTProvider {
  private config: DeepgramConfig;
  private client: any;
  private connection: any;
  private isReady: boolean = false;
  private aggregator: SegmentAggregator;

  // 마지막 INTERIM 결과 저장 (disconnect 시 처리용)
  private lastInterimText: string = '';

  constructor(roomId: string, config: DeepgramConfig) {
    super(roomId);

    this.config = {
      model: 'nova-3',
      language: 'ko',
      smartFormat: true,
      punctuate: true,
      interimResults: true,
      promptTemplate: 'general',
      ...config,
    };

    // 항상 Nova-3 사용 (keywords 포기, 인식률 우선)
    this.config.model = 'nova-3';

    this.aggregator = new SegmentAggregator((text, confidence) => {
      this.emit('transcript', {
        text,
        confidence,
        final: true,
      });
    });
  }

  /**
   * Connect - Nova-3 최적화 설정
   */
  async connect(): Promise<void> {
    try {
      if (!this.config.apiKey || this.config.apiKey.trim() === '') {
        throw new Error('Deepgram API key is missing');
      }

      this.client = createClient(this.config.apiKey);

      const options: any = {
        model: 'nova-3',
        language: this.config.language,
        smart_format: true,
        punctuate: true,
        interim_results: this.config.interimResults,
        endpointing: 800,          // 800ms (기존 1000~1500ms → 800ms)
        utterance_end_ms: 1500,    // 1500ms (기존 2000~3000ms → 1500ms)
        vad_events: true,
        filler_words: false,
        numerals: true,
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
      };

      if (this.config.tier) {
        options.tier = this.config.tier;
      }
      if (this.config.version) {
        options.version = this.config.version;
      }

      this.connection = this.client.listen.live(options);

      this.connection.on(LiveTranscriptionEvents.Open, () => {
        this.isReady = true;
        this.isConnected = true;
        this.emit('connected');
      });

      this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        try {
          const transcript = data.channel?.alternatives?.[0]?.transcript;
          if (!transcript || transcript.trim() === '') return;

          const isFinal = data.is_final || false;
          const confidence = data.channel?.alternatives?.[0]?.confidence || 0;

          if (!isFinal) {
            this.lastInterimText = transcript;
            this.emit('transcript', {
              text: transcript,
              confidence,
              final: false,
            });
            return;
          }

          // Final → SegmentAggregator로 전달 (300ms 윈도우로 합침)
          this.lastInterimText = '';
          this.aggregator.add(transcript, confidence);
        } catch (err) {
          console.error(`[Deepgram] Error processing transcript:`, err);
        }
      });

      this.connection.on(LiveTranscriptionEvents.Metadata, (_metadata: any) => {
        // Metadata received
      });

      this.connection.on(LiveTranscriptionEvents.Close, (_closeEvent: any) => {
        this.isReady = false;
        this.isConnected = false;
        this.emit('disconnected');
      });

      this.connection.on(LiveTranscriptionEvents.Error, (error: any) => {
        console.error(`[Deepgram] WebSocket ERROR:`, error);
        this.emit('error', error);
      });

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        const checkReady = () => {
          if (this.isReady) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(checkReady, 100);
          }
        };
        checkReady();
      });

    } catch (error) {
      console.error(`[Deepgram] Connection failed:`, error);
      throw error;
    }
  }

  /**
   * Send audio
   */
  sendAudio(audioData: Buffer): void {
    if (!this.isReady || !this.connection) {
      return;
    }

    try {
      this.connection.send(audioData);
    } catch (error) {
      console.error(`[Deepgram] Send error:`, error);
    }
  }

  /**
   * End stream - flush aggregator and finish connection
   */
  endStream(): void {
    if (this.lastInterimText) {
      this.aggregator.add(this.lastInterimText, 0.5);
      this.lastInterimText = '';
    }

    this.aggregator.flush();

    if (this.connection) {
      try {
        this.connection.finish();
      } catch (error) {
        // Ignore
      }
    }
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    if (this.lastInterimText) {
      this.aggregator.add(this.lastInterimText, 0.5);
      this.lastInterimText = '';
    }

    this.aggregator.flush();
    this.aggregator.destroy();

    if (this.connection) {
      try {
        this.connection.finish();
      } catch (error) {
        // Ignore
      }
      this.connection = null;
    }

    this.isReady = false;
    this.isConnected = false;
    this.emit('disconnected');
  }

  /**
   * Check if active
   */
  isActive(): boolean {
    return this.isConnected && this.isReady;
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'deepgram-nova-3';
  }
}
