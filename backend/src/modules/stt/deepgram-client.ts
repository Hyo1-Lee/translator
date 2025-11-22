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
  private readonly FLUSH_TIMEOUT_MS = 800; // 0.8초 후 자동 flush (속도 최적화: 1000ms→800ms)
  private readonly SENTENCE_ENDINGS = /[.!?。！？]/; // 문장 종결 부호 (한국어 + 영어)

  constructor(roomId: string, config: DeepgramConfig) {
    super(roomId);

    this.config = {
      model: 'nova-3',
      language: 'ko',
      smartFormat: true,
      punctuate: true,
      interimResults: true,
      ...config,
    };

    console.log(`[Deepgram][${roomId}] 🚀 Initializing...`);
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

        // 포맷팅 설정 - 띄어쓰기 및 구두점
        smart_format: true,
        punctuate: true,

        // 실시간 결과
        interim_results: this.config.interimResults,

        // 발화 끝점 감지 - 속도 최적화 (화자 정지 시 즉시 번역)
        endpointing: 100,          // 발화 끝 감지 시간 (안정성 유지)
        utterance_end_ms: 1200,    // 발화 종료 판단 시간 (속도 최적화: 1500ms→1200ms)

        // VAD (Voice Activity Detection)
        vad_events: true,           // 음성 활동 감지 이벤트

        // 한국어 특화 설정
        filler_words: false,        // 필러 단어 제거 (어, 음 등)

        // 오디오 포맷
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
      };

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

            // Interim results: emit immediately for real-time display
            if (!isFinal) {
              this.emit('transcript', {
                text: transcript,
                confidence,
                final: false,
              });
              return;
            }

            // Final results: buffer and emit complete sentences
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
   * Sentence Buffering - Add transcript to buffer
   */
  private addToSentenceBuffer(transcript: string, confidence: number): void {
    console.log(`[Deepgram][${this.roomId}] 📝 Adding to buffer: "${transcript}"`);

    this.sentenceBuffer.push(transcript);

    // Reset flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    // Check if sentence is complete (ends with punctuation)
    const hasSentenceEnding = this.SENTENCE_ENDINGS.test(transcript);

    if (hasSentenceEnding) {
      console.log(`[Deepgram][${this.roomId}] ✅ Sentence ending detected - flushing immediately`);
      this.flushSentenceBuffer(confidence);
    } else {
      // Set timer to flush after timeout
      console.log(`[Deepgram][${this.roomId}] ⏰ No sentence ending - will flush in ${this.FLUSH_TIMEOUT_MS}ms`);
      this.flushTimer = setTimeout(() => {
        console.log(`[Deepgram][${this.roomId}] ⏰ Flush timeout reached - flushing buffer`);
        this.flushSentenceBuffer(confidence);
      }, this.FLUSH_TIMEOUT_MS);
    }
  }

  /**
   * Flush sentence buffer - emit complete sentence
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
    const completeSentence = this.sentenceBuffer.join(' ').trim();

    console.log(`[Deepgram][${this.roomId}] 🚀 Flushing buffer: "${completeSentence}" (${this.sentenceBuffer.length} parts)`);

    // Emit complete sentence
    this.emit('transcript', {
      text: completeSentence,
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
