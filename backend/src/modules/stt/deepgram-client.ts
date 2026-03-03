import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { STTProvider } from './stt-provider.interface';

/**
 * Deepgram Configuration
 */
interface DeepgramConfig {
  apiKey: string;
  language?: string;
  smartFormat?: boolean;
  punctuate?: boolean;
  interimResults?: boolean;
  promptTemplate?: string;
}

/**
 * TextAccumulator - is_final 텍스트를 글자 수 + 시간 기반으로 축적하여 번역 단위로 전달.
 *
 * 플러시 트리거 (우선순위):
 *   1. utterance_end (화자 침묵) → 즉시 flush (길이 무관)
 *   2. MAX_BUFFER_CHARS 초과 (200자) → 즉시 flush
 *   3. MIN_FLUSH_CHARS 이상 (40자) + debounce 1초 경과 → flush
 *   4. HARD_TIMEOUT (8초) → 안전망 flush
 */
class TextAccumulator {
  private buffer: string = '';
  private debounceTimer: NodeJS.Timeout | null = null;
  private hardTimer: NodeJS.Timeout | null = null;
  private onFlush: (text: string) => void;

  private readonly MIN_FLUSH_CHARS = 40;
  private readonly MAX_BUFFER_CHARS = 200;
  private readonly DEBOUNCE_MS = 1000;
  private readonly HARD_TIMEOUT_MS = 8000;

  constructor(onFlush: (text: string) => void) {
    this.onFlush = onFlush;
  }

  add(text: string): void {
    this.buffer += (this.buffer ? ' ' : '') + text;
    this.resetHardTimer();

    if (this.buffer.length >= this.MAX_BUFFER_CHARS) {
      this.flush();
      return;
    }

    if (this.buffer.length >= this.MIN_FLUSH_CHARS) {
      this.startDebounce();
    }
  }

  onUtteranceEnd(): void {
    if (this.buffer.trim()) {
      this.flush();
    }
  }

  private startDebounce(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flush(), this.DEBOUNCE_MS);
  }

  private resetHardTimer(): void {
    if (this.hardTimer) clearTimeout(this.hardTimer);
    this.hardTimer = setTimeout(() => this.flush(), this.HARD_TIMEOUT_MS);
  }

  flush(): void {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    if (this.hardTimer) { clearTimeout(this.hardTimer); this.hardTimer = null; }

    const text = this.buffer.trim();
    this.buffer = '';

    if (text.length > 0) {
      this.onFlush(text);
    }
  }

  destroy(): void {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    if (this.hardTimer) { clearTimeout(this.hardTimer); this.hardTimer = null; }
    this.buffer = '';
  }
}

/**
 * Deepgram Client - Nova-3, TextAccumulator로 글자 수 + 시간 기반 번역 단위 전달
 */
export class DeepgramClient extends STTProvider {
  private config: DeepgramConfig;
  private client: any;
  private connection: any;
  private isReady: boolean = false;
  private textAccumulator: TextAccumulator;

  constructor(roomId: string, config: DeepgramConfig) {
    super(roomId);

    this.config = {
      language: 'ko',
      smartFormat: true,
      punctuate: true,
      interimResults: true,
      promptTemplate: 'general',
      ...config,
    };

    this.textAccumulator = new TextAccumulator((text) => {
      this.emit('transcript', {
        text,
        confidence: 0,
        final: true,
      });
    });
  }

  /**
   * Connect - 정확도 우선 설정
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
        endpointing: 800,          // 800ms (빠른 is_final → TextAccumulator가 축적 판단)
        utterance_end_ms: 1500,    // 1500ms (화자 침묵 감지 → TextAccumulator 즉시 flush)
        vad_events: true,
        filler_words: false,
        numerals: true,
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
      };

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
            this.emit('transcript', {
              text: transcript,
              confidence,
              final: false,
            });
            return;
          }

          // Final → TextAccumulator (글자 수 + 시간 기반 축적)
          this.textAccumulator.add(transcript);
        } catch (err) {
          console.error(`[Deepgram] Error processing transcript:`, err);
        }
      });

      // UtteranceEnd: 화자 침묵 감지 → TextAccumulator 즉시 flush
      this.connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
        this.textAccumulator.onUtteranceEnd();
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
   * End stream - flush buffer and finish connection
   */
  endStream(): void {
    this.textAccumulator.flush();

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
    this.textAccumulator.flush();
    this.textAccumulator.destroy();

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
