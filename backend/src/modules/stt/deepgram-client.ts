import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { STTProvider } from './stt-provider.interface';
import { getKeywords, toKeyterms, KeywordConfig } from './keywords-config';
import { processTranscript, isCompleteSentence, formatForDisplay } from './text-processor';

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
  promptTemplate?: string;  // Template for keywords (church, medical, etc.)
}

/**
 * Deepgram Client - 공식 SDK 문서대로 구현
 */
export class DeepgramClient extends STTProvider {
  private config: DeepgramConfig;
  private client: any;
  private connection: any;
  private isReady: boolean = false;

  // Sentence buffering
  private sentenceBuffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly FLUSH_TIMEOUT_MS = 800;
  private readonly SENTENCE_ENDINGS = /[.!?。！？]/;

  // 마지막 INTERIM 결과 저장 (disconnect 시 처리용)
  private lastInterimText: string = '';
  private lastInterimConfidence: number = 0;

  // Keywords for the current session
  private keywords: KeywordConfig[] = [];

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

    // Load keywords based on prompt template
    this.keywords = getKeywords(this.config.promptTemplate || 'general');
  }

  /**
   * Connect - Nova 모델 live streaming 공식 문서대로
   */
  async connect(): Promise<void> {
    try {
      // Validate API key
      if (!this.config.apiKey || this.config.apiKey.trim() === '') {
        throw new Error('Deepgram API key is missing');
      }

      // Create Deepgram client
      this.client = createClient(this.config.apiKey);

      // Connection options - 한국어 최적화 설정
      const options: any = {
        model: this.config.model,
        language: this.config.language,
        smart_format: true,           // 자동 구두점 및 포맷팅
        punctuate: true,              // 마침표 자동 추가
        interim_results: this.config.interimResults,
        endpointing: 1500,            // 1.5초 침묵 감지
        utterance_end_ms: 2500,       // 2초 후 발화 종료 확정
        vad_events: true,
        filler_words: false,
        numerals: true,
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
      };

      // Enhanced/Nova-2 모델에서만 keywords 사용 가능
      if (this.config.model !== 'nova-3' && this.keywords.length > 0) {
        const keyterms = toKeyterms(this.keywords);
        if (keyterms.length > 0) {
          options.keywords = keyterms;
        }
      }

      if (this.config.tier) {
        options.tier = this.config.tier;
      }
      if (this.config.version) {
        options.version = this.config.version;
      }

      // Create connection
      this.connection = this.client.listen.live(options);

      // Setup event handlers
      this.connection.on(LiveTranscriptionEvents.Open, () => {
        this.isReady = true;
        this.isConnected = true;
        this.emit('connected');
      });

      this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        try {
          const transcript = data.channel?.alternatives?.[0]?.transcript;
          if (transcript && transcript.trim() !== '') {
            const isFinal = data.is_final || false;
            const confidence = data.channel?.alternatives?.[0]?.confidence || 0;

            // Interim results: emit for real-time display
            if (!isFinal) {
              this.lastInterimText = transcript;
              this.lastInterimConfidence = confidence;

              if (this.flushTimer) {
                clearTimeout(this.flushTimer);
                this.flushTimer = setTimeout(() => {
                  const buffer = this.sentenceBuffer.join(' ').trim();
                  if (buffer.length > 0) {
                    this.flushSentenceBuffer(this.lastInterimConfidence);
                  }
                }, this.FLUSH_TIMEOUT_MS);
              }

              this.emit('transcript', {
                text: transcript,
                confidence,
                final: false,
              });
              return;
            }

            // Final results
            this.lastInterimText = '';
            this.lastInterimConfidence = 0;

            this.addToSentenceBuffer(transcript, confidence);
          }
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
  private audioChunksSent = 0;

  sendAudio(audioData: Buffer): void {
    if (!this.isReady || !this.connection) {
      return;
    }

    try {
      this.connection.send(audioData);
      this.audioChunksSent++;
    } catch (error) {
      console.error(`[Deepgram] Send error:`, error);
    }
  }

  /**
   * Sentence Buffering - Add transcript to buffer with simple flushing
   */
  private addToSentenceBuffer(transcript: string, confidence: number): void {
    this.sentenceBuffer.push(transcript);

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    const currentBuffer = this.sentenceBuffer.join(' ').trim();
    const isComplete = isCompleteSentence(currentBuffer);
    const isTooLong = currentBuffer.length > 200;

    const shouldFlushNow = isComplete || isTooLong;

    if (shouldFlushNow) {
      this.flushSentenceBuffer(confidence);
    } else {
      this.flushTimer = setTimeout(() => {
        const buffer = this.sentenceBuffer.join(' ').trim();
        if (buffer.length > 0) {
          this.flushSentenceBuffer(confidence);
        }
      }, this.FLUSH_TIMEOUT_MS);
    }
  }

  /**
   * Flush sentence buffer - emit complete sentence with post-processing
   */
  private flushSentenceBuffer(confidence: number): void {
    if (this.sentenceBuffer.length === 0) {
      return;
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const rawSentence = this.sentenceBuffer.join(' ').trim();
    const processedSentence = processTranscript(rawSentence);

    if (!processedSentence) {
      this.sentenceBuffer = [];
      return;
    }

    const displaySentence = formatForDisplay(processedSentence);

    this.emit('transcript', {
      text: displaySentence,
      confidence,
      final: true,
    });

    this.sentenceBuffer = [];
  }

  /**
   * End stream (flush)
   */
  endStream(): void {
    if (this.lastInterimText) {
      this.sentenceBuffer.push(this.lastInterimText);
      this.lastInterimText = '';
      this.lastInterimConfidence = 0;
    }

    if (this.sentenceBuffer.length > 0) {
      this.flushSentenceBuffer(1.0);
    }

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
      this.sentenceBuffer.push(this.lastInterimText);
      this.lastInterimText = '';
      this.lastInterimConfidence = 0;
    }

    if (this.sentenceBuffer.length > 0) {
      this.flushSentenceBuffer(1.0);
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

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
    return `deepgram-${this.config.model}`;
  }
}
