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
 * TextAccumulator - 문장 완성 인식 + 글자 수/시간 기반 축적
 *
 * 핵심: 한국어 문장은 거의 항상 다/요/죠/까/오/니로 끝남.
 * 이 패턴이 버퍼 끝에 없으면 미완성 → flush 보류.
 *
 * 플러시 트리거 (우선순위):
 *   1. utterance_end (화자 침묵) → 즉시 flush, forceComplete=true
 *   2. MAX_BUFFER_CHARS (200자) → 마지막 문장 경계에서 분할 flush
 *   3. 문장 종결 패턴 + MIN_FLUSH_CHARS (40자) + debounce 1초 → flush
 *   4. HARD_TIMEOUT (8초) → 안전망 flush, forceComplete=true
 */
class TextAccumulator {
  private buffer: string = '';
  private debounceTimer: NodeJS.Timeout | null = null;
  private hardTimer: NodeJS.Timeout | null = null;
  private onFlush: (text: string, forceComplete: boolean) => void;

  private readonly MIN_FLUSH_CHARS = 40;
  private readonly MAX_BUFFER_CHARS = 200;
  private readonly DEBOUNCE_MS = 1000;
  private readonly HARD_TIMEOUT_MS = 8000;

  // 한국어 문장 종결 패턴 (마지막 글자 기준)
  private readonly ENDS_WITH_SENTENCE = /[다요죠까오니]\s*[.?!。]?\s*$/;

  constructor(onFlush: (text: string, forceComplete: boolean) => void) {
    this.onFlush = onFlush;
  }

  add(text: string): void {
    this.buffer += (this.buffer ? ' ' : '') + text;
    this.resetHardTimer();

    if (this.buffer.length >= this.MAX_BUFFER_CHARS) {
      this.flushWithSplit();
      return;
    }

    // 문장 종결 + 최소 글자 → debounce 시작
    if (this.buffer.length >= this.MIN_FLUSH_CHARS && this.ENDS_WITH_SENTENCE.test(this.buffer)) {
      this.startDebounce();
    } else if (this.debounceTimer) {
      // 추가 텍스트로 종결 패턴이 깨짐 → debounce 취소
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  onUtteranceEnd(): void {
    if (this.buffer.trim()) {
      this.flush(true);
    }
  }

  /**
   * MAX_BUFFER_CHARS 도달 시: 마지막 문장 경계에서 분할
   */
  private flushWithSplit(): void {
    const text = this.buffer;
    const lastEnd = this.findLastSentenceEnd(text);

    if (lastEnd > 0 && lastEnd < text.length) {
      const complete = text.substring(0, lastEnd).trim();
      const remaining = text.substring(lastEnd).trim();

      this.clearTimers();
      this.buffer = remaining;

      if (complete.length > 0) {
        this.onFlush(complete, false);
      }

      this.resetHardTimer();
    } else {
      // 분할 불가 → 강제 flush
      this.flush(true);
    }
  }

  /**
   * 텍스트 내에서 마지막 문장 종결 위치 찾기
   */
  private findLastSentenceEnd(text: string): number {
    const re = /[다요죠까오니]\s*[.?!。]?\s+/g;
    let lastEnd = -1;
    let match;
    while ((match = re.exec(text)) !== null) {
      lastEnd = match.index + match[0].length;
    }
    return lastEnd;
  }

  private startDebounce(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flush(false), this.DEBOUNCE_MS);
  }

  private resetHardTimer(): void {
    if (this.hardTimer) clearTimeout(this.hardTimer);
    this.hardTimer = setTimeout(() => this.flush(true), this.HARD_TIMEOUT_MS);
  }

  private clearTimers(): void {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    if (this.hardTimer) { clearTimeout(this.hardTimer); this.hardTimer = null; }
  }

  flush(forceComplete: boolean = false): void {
    this.clearTimers();

    const text = this.buffer.trim();
    this.buffer = '';

    if (text.length > 0) {
      this.onFlush(text, forceComplete);
    }
  }

  destroy(): void {
    this.clearTimers();
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

    this.textAccumulator = new TextAccumulator((text, forceComplete) => {
      this.emit('transcript', {
        text,
        confidence: 0,
        final: true,
        forceComplete,
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
    this.textAccumulator.flush(true);

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
    this.textAccumulator.flush(true);
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
