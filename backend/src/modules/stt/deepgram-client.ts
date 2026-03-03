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
 * SentenceBuffer - STT is_final 세그먼트를 축적하여 완성된 문장 단위로 전달.
 *
 * 플러시 트리거 (우선순위):
 *   1. utterance_end 이벤트 (화자 침묵 감지 → 즉시 플러시)
 *   2. 한국어 종결어미 감지 + 800ms 디바운스
 *   3. 하드 타임아웃 10초 (안전망)
 */
class SentenceBuffer {
  private buffer: string = '';
  private sentenceTimer: NodeJS.Timeout | null = null;
  private hardTimer: NodeJS.Timeout | null = null;
  private onFlush: (text: string) => void;

  // 설정
  private readonly SENTENCE_DEBOUNCE_MS = 800;
  private readonly HARD_TIMEOUT_MS = 10000;
  private readonly MIN_CHARS_FOR_SENTENCE = 8;

  // 한국어 종결어미 패턴
  // 형식체/비형식체 종결어미를 광범위하게 커버
  private readonly SENTENCE_END_RE = new RegExp(
    '(?:' +
      // 합쇼체 (formal): ~합니다, ~습니다, ~ㅂ니다, ~합니까, ~습니까
      '합니다|습니다|ㅂ니다|합니까|습니까|' +
      // 해요체 (polite): ~해요, ~에요, ~예요, ~이에요, ~거든요, ~잖아요, ~네요, ~는데요, ~군요, ~죠
      '해요|에요|예요|이에요|거든요|잖아요|네요|는데요|던데요|군요|구요|죠|' +
      // 해체 (casual): ~해, ~야, ~지, ~네, ~거든, ~잖아
      '거든|잖아|' +
      // 하게체/하오체 (literary)
      '하오|하게|' +
      // 명령/청유: ~세요, ~십시오, ~시죠, ~합시다, ~읍시다
      '하세요|세요|십시오|시죠|합시다|읍시다|' +
      // 연결+종결: ~고요, ~는데, ~인데
      '고요|는데요|인데요' +
    ')' +
    '[.?!。]?\\s*$'  // 선택적 문장 부호
  );

  constructor(onFlush: (text: string) => void) {
    this.onFlush = onFlush;
  }

  /**
   * is_final 텍스트 추가
   */
  add(text: string): void {
    this.buffer += (this.buffer ? ' ' : '') + text;

    // 하드 타임아웃 리셋
    this.resetHardTimer();

    // 한국어 종결어미 감지 → 디바운스 플러시
    if (
      this.buffer.length >= this.MIN_CHARS_FOR_SENTENCE &&
      this.SENTENCE_END_RE.test(this.buffer)
    ) {
      this.startSentenceDebounce();
    }
  }

  /**
   * Deepgram utterance_end 이벤트 (화자 침묵) → 즉시 플러시
   */
  onUtteranceEnd(): void {
    if (this.buffer.trim()) {
      this.flush();
    }
  }

  private startSentenceDebounce(): void {
    if (this.sentenceTimer) clearTimeout(this.sentenceTimer);
    this.sentenceTimer = setTimeout(() => this.flush(), this.SENTENCE_DEBOUNCE_MS);
  }

  private resetHardTimer(): void {
    if (this.hardTimer) clearTimeout(this.hardTimer);
    this.hardTimer = setTimeout(() => this.flush(), this.HARD_TIMEOUT_MS);
  }

  flush(): void {
    if (this.sentenceTimer) { clearTimeout(this.sentenceTimer); this.sentenceTimer = null; }
    if (this.hardTimer) { clearTimeout(this.hardTimer); this.hardTimer = null; }

    const text = this.buffer.trim();
    this.buffer = '';

    if (text.length > 0) {
      this.onFlush(text);
    }
  }

  destroy(): void {
    if (this.sentenceTimer) { clearTimeout(this.sentenceTimer); this.sentenceTimer = null; }
    if (this.hardTimer) { clearTimeout(this.hardTimer); this.hardTimer = null; }
    this.buffer = '';
  }
}

/**
 * Deepgram Client - Nova-3, SentenceBuffer로 완성된 문장 단위 전달
 */
export class DeepgramClient extends STTProvider {
  private config: DeepgramConfig;
  private client: any;
  private connection: any;
  private isReady: boolean = false;
  private sentenceBuffer: SentenceBuffer;

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

    this.config.model = 'nova-3';

    this.sentenceBuffer = new SentenceBuffer((text) => {
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
        endpointing: 1200,         // 1200ms (정확도 우선: Deepgram이 더 긴 구간을 한 번에 처리)
        utterance_end_ms: 2000,    // 2000ms (화자 침묵 감지 → SentenceBuffer 플러시)
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

          // Final → SentenceBuffer (문장 완성까지 축적)
          this.lastInterimText = '';
          this.sentenceBuffer.add(transcript);
        } catch (err) {
          console.error(`[Deepgram] Error processing transcript:`, err);
        }
      });

      // UtteranceEnd: 화자 침묵 감지 → SentenceBuffer 즉시 플러시
      this.connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
        this.sentenceBuffer.onUtteranceEnd();
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
    if (this.lastInterimText) {
      this.sentenceBuffer.add(this.lastInterimText);
      this.lastInterimText = '';
    }

    this.sentenceBuffer.flush();

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
      this.sentenceBuffer.add(this.lastInterimText);
      this.lastInterimText = '';
    }

    this.sentenceBuffer.flush();
    this.sentenceBuffer.destroy();

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
