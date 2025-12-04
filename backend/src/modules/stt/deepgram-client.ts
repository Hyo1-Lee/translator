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
 * https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio
 */
export class DeepgramClient extends STTProvider {
  private config: DeepgramConfig;
  private client: any;
  private connection: any;
  private isReady: boolean = false;

  // Sentence buffering
  private sentenceBuffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly FLUSH_TIMEOUT_MS = 500; // 0.5초 후 자동 flush
  private readonly SENTENCE_ENDINGS = /[.!?。！？]/; // 문장 종결 부호 (한국어 + 영어)

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
    console.log(`[Deepgram][${roomId}] 🚀 Initializing with template: ${this.config.promptTemplate}, keywords: ${this.keywords.length}`);
  }

  /**
   * Connect - Nova 모델 live streaming 공식 문서대로
   */
  async connect(): Promise<void> {
    try {
      console.log(`[Deepgram][${this.roomId}] 🔌 Connecting to Deepgram...`);

      // Validate API key
      if (!this.config.apiKey || this.config.apiKey.trim() === '') {
        throw new Error('Deepgram API key is missing');
      }

      // Create Deepgram client
      this.client = createClient(this.config.apiKey);
      console.log(`[Deepgram][${this.roomId}] ✅ Client created`);

      // Connection options - 한국어 최적화 설정
      const options: any = {
        model: this.config.model,
        language: this.config.language,

        // 포맷팅 설정
        // ⚠️ smart_format과 punctuate는 한국어에서 제대로 작동하지 않음
        // - 띄어쓰기 안됨
        // - 문장 중간에 온점 추가됨
        // → 후처리에서 직접 처리
        smart_format: false,
        punctuate: false,

        // 실시간 결과
        interim_results: this.config.interimResults,

        // 발화 끝점 감지 - 균형 설정
        // ⚠️ 너무 길면 여러 문장이 합쳐짐, 너무 짧으면 문장 중간에 끊김
        endpointing: 800,           // 발화 끝 감지 시간 (380ms - 균형점)
        utterance_end_ms: 1200,     // 발화 종료 판단 시간 (1.2초)

        // VAD (Voice Activity Detection)
        vad_events: true,           // 음성 활동 감지 이벤트

        // 한국어 특화 설정
        filler_words: false,        // 필러 단어 제거 (어, 음 등)

        // 숫자 형식
        numerals: true,             // 숫자를 텍스트가 아닌 숫자로 표시

        // 오디오 포맷
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
      };

      // NOTE: Nova-3 모델은 keywords 파라미터를 지원하지 않음 (HTTP 400 에러 발생)
      // Nova-3는 자체적으로 매우 정확하므로 keywords 없이도 잘 작동함
      // Enhanced/Nova-2 모델에서만 keywords 사용 가능
      if (this.config.model !== 'nova-3' && this.keywords.length > 0) {
        const keyterms = toKeyterms(this.keywords);
        if (keyterms.length > 0) {
          options.keywords = keyterms;
          console.log(`[Deepgram][${this.roomId}] 📚 Added ${keyterms.length} keyterms for better recognition`);
        }
      } else if (this.keywords.length > 0) {
        console.log(`[Deepgram][${this.roomId}] ℹ️ Keywords skipped (Nova-3 does not support keywords parameter)`);
      }

      // Enhanced 모델을 위한 tier/version 추가
      if (this.config.tier) {
        options.tier = this.config.tier;
      }
      if (this.config.version) {
        options.version = this.config.version;
      }

      console.log(`[Deepgram][${this.roomId}] 📋 Connection options:`, JSON.stringify(options, null, 2));

      // Create connection
      this.connection = this.client.listen.live(options);
      console.log(`[Deepgram][${this.roomId}] 🔗 Connection object created`);

      // Setup event handlers - 공식 SDK 방식
      this.connection.on(LiveTranscriptionEvents.Open, () => {
        console.log(`[Deepgram][${this.roomId}] ✅ WebSocket OPEN - Connection established`);
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

            console.log(`[Deepgram][${this.roomId}] ${isFinal ? '✅ FINAL' : '⏳ INTERIM'} "${transcript}" (confidence: ${(confidence * 100).toFixed(1)}%)`);

            // Interim results: emit for real-time display + 타이머 리셋 (말하는 중 신호)
            if (!isFinal) {
              // 마지막 INTERIM 저장 (FINAL 없이 disconnect 되면 이걸 사용)
              this.lastInterimText = transcript;
              this.lastInterimConfidence = confidence;

              // INTERIM이 오면 타이머 리셋 - "아직 말하는 중"이라는 신호
              // 이렇게 해야 Deepgram 응답이 느려도 문장 중간에 끊기지 않음
              if (this.flushTimer) {
                clearTimeout(this.flushTimer);
                this.flushTimer = setTimeout(() => {
                  const buffer = this.sentenceBuffer.join(' ').trim();
                  if (buffer.length > 0) {
                    console.log(`[Deepgram][${this.roomId}] 📝 Flush reason: timeout after interim (${buffer.length} chars)`);
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

            // Final results: buffer and emit complete sentences
            // FINAL이 오면 lastInterim 클리어 (이미 처리됨)
            this.lastInterimText = '';
            this.lastInterimConfidence = 0;

            this.addToSentenceBuffer(transcript, confidence);
          }
        } catch (err) {
          console.error(`[Deepgram][${this.roomId}] ❌ Error processing transcript:`, err);
        }
      });

      this.connection.on(LiveTranscriptionEvents.Metadata, (metadata: any) => {
        console.log(`[Deepgram][${this.roomId}] 📊 Metadata:`, JSON.stringify(metadata));
      });

      this.connection.on(LiveTranscriptionEvents.Close, (closeEvent: any) => {
        console.log(`[Deepgram][${this.roomId}] 🔴 WebSocket CLOSE - Code: ${closeEvent?.code || 'unknown'}, Reason: "${closeEvent?.reason || 'none'}"`);
        this.isReady = false;
        this.isConnected = false;
        this.emit('disconnected');
      });

      this.connection.on(LiveTranscriptionEvents.Error, (error: any) => {
        console.error(`[Deepgram][${this.roomId}] ❌ WebSocket ERROR:`, error);
        this.emit('error', error);
      });

      // Wait for connection with better error handling
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.error(`[Deepgram][${this.roomId}] ⏰ Connection timeout after 10 seconds`);
          reject(new Error('Connection timeout - WebSocket did not open'));
        }, 10000);

        const checkReady = () => {
          if (this.isReady) {
            clearTimeout(timeout);
            console.log(`[Deepgram][${this.roomId}] ✅ Connection ready confirmed`);
            resolve();
          } else {
            setTimeout(checkReady, 100);
          }
        };
        checkReady();
      });

    } catch (error) {
      console.error(`[Deepgram][${this.roomId}] ❌ Connection failed:`, error);
      console.error(`[Deepgram][${this.roomId}] ❌ Stack:`, error instanceof Error ? error.stack : 'N/A');
      throw error;
    }
  }

  /**
   * Send audio - 공식 SDK 문서대로 바로 전송
   */
  private audioChunksSent = 0;

  sendAudio(audioData: Buffer): void {
    if (!this.isReady) {
      if (this.audioChunksSent === 0) {
        console.warn(`[Deepgram][${this.roomId}] ⚠️  Not ready - cannot send audio`);
      }
      return;
    }

    if (!this.connection) {
      if (this.audioChunksSent === 0) {
        console.error(`[Deepgram][${this.roomId}] ❌ No connection - cannot send audio`);
      }
      return;
    }

    try {
      this.connection.send(audioData);
      this.audioChunksSent++;

      // Log only first few chunks
      if (this.audioChunksSent === 1) {
        console.log(`[Deepgram][${this.roomId}] ✅ First audio chunk sent: ${audioData.length} bytes`);
      } else if (this.audioChunksSent === 10) {
        console.log(`[Deepgram][${this.roomId}] ✅ 10 audio chunks sent successfully`);
      } else if (this.audioChunksSent === 50) {
        console.log(`[Deepgram][${this.roomId}] ✅ 50 audio chunks sent successfully`);
      } else if (this.audioChunksSent % 100 === 0) {
        console.log(`[Deepgram][${this.roomId}] ✅ ${this.audioChunksSent} audio chunks sent`);
      }
    } catch (error) {
      console.error(`[Deepgram][${this.roomId}] ❌ Send error:`, error);
    }
  }

  /**
   * Sentence Buffering - Add transcript to buffer with simple flushing
   *
   * 단순화된 버퍼링 전략:
   * - Deepgram의 endpointing이 문장 단위를 결정
   * - 우리는 타이머 기반으로 빠르게 flush만 수행
   */
  private addToSentenceBuffer(transcript: string, confidence: number): void {
    this.sentenceBuffer.push(transcript);

    // Reset flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    // Get current buffer content
    const currentBuffer = this.sentenceBuffer.join(' ').trim();

    // 문장 완성 조건 체크
    const isComplete = isCompleteSentence(currentBuffer);
    const isTooLong = currentBuffer.length > 200; // 너무 길면 강제 flush

    // Flush 조건:
    // 1. 문장이 완성됨
    // 2. 버퍼가 너무 김 (200자 초과)
    const shouldFlushNow = isComplete || isTooLong;

    if (shouldFlushNow) {
      console.log(`[Deepgram][${this.roomId}] 📝 Flush reason: ${isTooLong ? 'too long' : 'complete sentence'} (${currentBuffer.length} chars)`);
      this.flushSentenceBuffer(confidence);
    } else {
      // Set timer to flush after timeout
      this.flushTimer = setTimeout(() => {
        const buffer = this.sentenceBuffer.join(' ').trim();
        if (buffer.length > 0) {
          console.log(`[Deepgram][${this.roomId}] 📝 Flush reason: timeout (${buffer.length} chars)`);
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

    // Clear timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Combine all buffered transcripts
    const rawSentence = this.sentenceBuffer.join(' ').trim();

    // Apply text post-processing
    const processedSentence = processTranscript(rawSentence);

    // Skip if empty after processing
    if (!processedSentence) {
      this.sentenceBuffer = [];
      return;
    }

    // Format for display
    const displaySentence = formatForDisplay(processedSentence);

    console.log(`[Deepgram][${this.roomId}] 🚀 Processed: "${displaySentence}" (raw: ${this.sentenceBuffer.length} parts)`);

    // Emit processed sentence
    this.emit('transcript', {
      text: displaySentence,
      confidence,
      final: true,
    });

    // Clear buffer
    this.sentenceBuffer = [];
  }

  /**
   * End stream (flush)
   */
  endStream(): void {
    // 마지막 INTERIM이 있으면 FINAL로 처리
    if (this.lastInterimText) {
      console.log(`[Deepgram][${this.roomId}] 🔚 End stream - processing last interim: "${this.lastInterimText}"`);
      this.sentenceBuffer.push(this.lastInterimText);
      this.lastInterimText = '';
      this.lastInterimConfidence = 0;
    }

    // Flush any remaining buffer
    if (this.sentenceBuffer.length > 0) {
      console.log(`[Deepgram][${this.roomId}] 🔚 End stream - flushing remaining buffer`);
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
    console.log(`[Deepgram][${this.roomId}] 🔌 Disconnecting...`);

    // 마지막 INTERIM이 있으면 FINAL로 처리 (FINAL 없이 disconnect 된 경우)
    if (this.lastInterimText) {
      console.log(`[Deepgram][${this.roomId}] 🔚 Processing last interim as final: "${this.lastInterimText}"`);
      this.sentenceBuffer.push(this.lastInterimText);
      this.lastInterimText = '';
      this.lastInterimConfidence = 0;
    }

    // Flush any remaining buffer
    if (this.sentenceBuffer.length > 0) {
      console.log(`[Deepgram][${this.roomId}] 🔚 Disconnect - flushing remaining buffer`);
      this.flushSentenceBuffer(1.0);
    }

    // Clear timer
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
