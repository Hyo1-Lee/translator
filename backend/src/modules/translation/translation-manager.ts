import { TranslationService } from './translation-service';
import { GoogleTranslateService } from './google-translate.service';
import { EnvironmentPreset } from './presets';

/**
 * TranslationManager 설정
 */
export interface TranslationManagerConfig {
  roomId: string;
  sourceLanguage: string;  // 출발 언어 (기본: 'ko')
  environmentPreset: EnvironmentPreset;
  customEnvironmentDescription?: string;
  customGlossary?: Record<string, string>;
  targetLanguages: string[];  // ['en', 'ja', 'zh', ...]
  enableStreaming: boolean;
  translationService: TranslationService;  // GPT (출발어 → 영어)
  googleTranslateService: GoogleTranslateService;  // Google (영어 → 다국어)
  onTranslation: (data: TranslationData) => void;  // 콜백
  onError?: (error: Error) => void;  // 에러 콜백
}

/**
 * 번역 결과 데이터
 */
export interface TranslationData {
  roomId: string;
  targetLanguage: string;
  originalText: string;
  translatedText: string;
  isPartial?: boolean;  // 스트리밍 중간 결과
  contextSummary?: string;  // 현재 요약
  timestamp: Date;
  sttTextId?: string;  // DB에 저장된 SttText ID
  confidence?: number;  // STT confidence score
}

/**
 * TranslationManager
 *
 * 실시간 문맥 유지 번역 관리자
 * - contextBuffer: LLM에 문맥 전달용 (최근 5개 문장)
 * - translationQueue: 번역 배치 처리용
 */
export class TranslationManager {
  private config: TranslationManagerConfig;
  private contextBuffer: string[] = [];      // LLM 문맥용 (최근 문장들)
  private summary: string = '';              // 대화 요약
  private translationQueue: Array<{ text: string; confidence?: number }> = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private transcriptCount: number = 0;       // 요약 주기 계산용
  private isProcessing: boolean = false;     // 중복 처리 방지

  // 번역 큐 최대 대기 시간
  private firstQueueItemTime: number | null = null;
  private readonly MAX_WAIT_TIME_MS = 1000; // 최대 1초 대기

  constructor(config: TranslationManagerConfig) {
    this.config = config;
    console.log(`[TranslationManager][${config.roomId}] 🚀 Initialized`);
    console.log(`[TranslationManager][${config.roomId}] Source: ${config.sourceLanguage}, Targets: ${config.targetLanguages.join(', ')}`);
    console.log(`[TranslationManager][${config.roomId}] Preset: ${config.environmentPreset}, Streaming: ${config.enableStreaming}`);
  }

  /**
   * Final transcript 추가 - Deepgram에서 이미 문장 완성 판단했으므로 바로 번역 큐에 추가
   */
  addTranscript(text: string, isFinal: boolean, confidence?: number): void {
    if (!isFinal) return;  // Final만 처리

    console.log(`[TranslationManager][${this.config.roomId}] ✅ Adding transcript: "${text.substring(0, 50)}..."`);

    // 컨텍스트 버퍼 업데이트 (LLM 문맥용)
    this.updateContext(text);

    // 번역 큐에 추가
    this.translationQueue.push({ text, confidence });

    // 배치 처리 스케줄링
    this.scheduleBatchProcessing();

    // 30개마다 요약 생성
    this.transcriptCount++;
    if (this.transcriptCount % 30 === 0) {
      console.log(`[TranslationManager][${this.config.roomId}] 📝 Generating summary (${this.transcriptCount} transcripts)`);
      this.regenerateSummary();
    }
  }

  /**
   * 배치 처리 스케줄링
   */
  private scheduleBatchProcessing(): void {
    // 첫 번째 아이템이 큐에 추가된 시간 기록
    if (this.firstQueueItemTime === null && this.translationQueue.length > 0) {
      this.firstQueueItemTime = Date.now();
    }

    // 최대 대기 시간 체크
    if (this.firstQueueItemTime !== null) {
      const waitTime = Date.now() - this.firstQueueItemTime;
      if (waitTime >= this.MAX_WAIT_TIME_MS) {
        console.log(`[TranslationManager][${this.config.roomId}] ⏰ Max wait time (${waitTime}ms) - processing now`);
        this.firstQueueItemTime = null;
        setImmediate(() => this.processTranslationBatch());
        return;
      }
    }

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // 큐가 많이 쌓이면 즉시 처리
    if (this.translationQueue.length >= 3) {
      console.log(`[TranslationManager][${this.config.roomId}] 🚨 Queue size (${this.translationQueue.length}) - processing now`);
      this.firstQueueItemTime = null;
      setImmediate(() => this.processTranslationBatch());
      return;
    }

    // 짧은 딜레이 후 처리 (배치 모으기)
    this.batchTimer = setTimeout(() => {
      this.firstQueueItemTime = null;
      this.processTranslationBatch();
    }, 100);
  }

  /**
   * 배치 번역 처리
   */
  private async processTranslationBatch(): Promise<void> {
    if (this.translationQueue.length === 0) return;
    if (this.isProcessing) {
      console.log(`[TranslationManager][${this.config.roomId}] ⏳ Already processing...`);
      return;
    }

    this.isProcessing = true;

    const batch = [...this.translationQueue];
    this.translationQueue = [];

    console.log(`[TranslationManager][${this.config.roomId}] 🔄 Processing batch of ${batch.length} items`);

    try {
      const useSmartBatch = batch.length >= 2 && typeof (this.config.translationService as any).translateBatch === 'function';

      if (useSmartBatch) {
        console.log(`[TranslationManager][${this.config.roomId}] ⚡ Using smart batch translation`);
        await this.processBatchSmart(batch);
      } else {
        for (const item of batch) {
          await this.translateToMultipleLanguages(item.text, item.confidence);
        }
      }
    } catch (error) {
      console.error(`[TranslationManager][${this.config.roomId}] ❌ Batch processing error:`, error);
      if (this.config.onError) {
        this.config.onError(error as Error);
      }
    } finally {
      this.isProcessing = false;
      this.firstQueueItemTime = null;

      if (this.translationQueue.length > 0) {
        setImmediate(() => this.processTranslationBatch());
      }
    }
  }

  /**
   * 스마트 배치 처리: 여러 문장을 한 번의 LLM 호출로 번역
   */
  private async processBatchSmart(batch: Array<{ text: string; confidence?: number }>): Promise<void> {
    const recentContext = this.contextBuffer.slice(-5).join(' ');

    if (this.config.sourceLanguage === 'en') {
      for (const item of batch) {
        await this.translateToMultipleLanguages(item.text, item.confidence);
      }
      return;
    }

    console.log(`[TranslationManager][${this.config.roomId}] 🤖 Groq batch: ${this.config.sourceLanguage} → en (${batch.length} items)`);

    const batchResults = await (this.config.translationService as any).translateBatch(
      batch,
      recentContext,
      this.summary,
      this.config.sourceLanguage,
      'en',
      this.config.environmentPreset,
      this.config.customEnvironmentDescription,
      this.config.customGlossary
    );

    if (!batchResults || batchResults.length === 0) {
      console.error(`[TranslationManager][${this.config.roomId}] ❌ Smart batch failed, fallback to sequential`);
      for (const item of batch) {
        await this.translateToMultipleLanguages(item.text, item.confidence);
      }
      return;
    }

    for (const result of batchResults) {
      const englishTranslation = result.translatedText;
      const originalText = result.originalText;
      const confidence = result.confidence;

      this.config.onTranslation({
        roomId: this.config.roomId,
        targetLanguage: 'en',
        originalText,
        translatedText: englishTranslation,
        isPartial: false,
        contextSummary: this.summary,
        timestamp: new Date(),
        sttTextId: undefined,
        confidence
      });

      const otherLanguages = this.config.targetLanguages.filter(lang => lang !== 'en');

      if (otherLanguages.length > 0) {
        const googleTranslations = await this.config.googleTranslateService.translateToMultipleLanguages(
          englishTranslation,
          otherLanguages
        );

        for (const [lang, translation] of Object.entries(googleTranslations)) {
          this.config.onTranslation({
            roomId: this.config.roomId,
            targetLanguage: lang,
            originalText,
            translatedText: translation,
            contextSummary: this.summary,
            timestamp: new Date(),
            sttTextId: 'saved',
            confidence
          });
        }
      }
    }
  }

  /**
   * 이중 번역: 출발어 → 영어 (GPT) → 다국어 (Google Translate)
   */
  private async translateToMultipleLanguages(
    text: string,
    confidence?: number
  ): Promise<void> {
    const recentContext = this.contextBuffer.slice(-5).join(' ');
    let sttTextId: string | undefined;

    if (this.config.sourceLanguage === 'en') {
      const translations = await this.config.googleTranslateService.translateToMultipleLanguages(
        text,
        this.config.targetLanguages
      );

      for (const [lang, translation] of Object.entries(translations)) {
        this.config.onTranslation({
          roomId: this.config.roomId,
          targetLanguage: lang,
          originalText: text,
          translatedText: translation,
          contextSummary: this.summary,
          timestamp: new Date(),
          sttTextId,
          confidence
        });

        if (!sttTextId) {
          sttTextId = 'saved';
        }
      }
      return;
    }

    console.log(`[TranslationManager][${this.config.roomId}] 🤖 GPT: ${this.config.sourceLanguage} → en`);

    let englishTranslation: string | null = null;

    if (this.config.enableStreaming) {
      let streamingBuffer = '';

      englishTranslation = await this.config.translationService.translateWithStreaming(
        text,
        recentContext,
        this.summary,
        this.config.sourceLanguage,
        'en',
        this.config.environmentPreset,
        this.config.customEnvironmentDescription,
        this.config.customGlossary,
        (chunk: string) => {
          streamingBuffer += chunk;
          this.config.onTranslation({
            roomId: this.config.roomId,
            targetLanguage: 'en',
            originalText: text,
            translatedText: streamingBuffer,
            isPartial: true,
            contextSummary: this.summary,
            timestamp: new Date()
          });
        }
      );
    } else {
      englishTranslation = await this.config.translationService.translateWithPreset(
        text,
        recentContext,
        this.summary,
        this.config.sourceLanguage,
        'en',
        this.config.environmentPreset,
        this.config.customEnvironmentDescription,
        this.config.customGlossary
      );
    }

    if (!englishTranslation) {
      console.error(`[TranslationManager][${this.config.roomId}] ❌ Failed to translate to English`);
      if (this.config.onError) {
        this.config.onError(new Error('Failed to translate to English'));
      }
      return;
    }

    console.log(`[TranslationManager][${this.config.roomId}] ✅ English: "${englishTranslation.substring(0, 50)}..."`);

    this.config.onTranslation({
      roomId: this.config.roomId,
      targetLanguage: 'en',
      originalText: text,
      translatedText: englishTranslation,
      isPartial: false,
      contextSummary: this.summary,
      timestamp: new Date(),
      sttTextId,
      confidence
    });

    sttTextId = 'saved';

    const otherLanguages = this.config.targetLanguages.filter(lang => lang !== 'en');

    if (otherLanguages.length > 0) {
      console.log(`[TranslationManager][${this.config.roomId}] 🌐 Google: en → [${otherLanguages.join(', ')}]`);

      const googleTranslations = await this.config.googleTranslateService.translateToMultipleLanguages(
        englishTranslation,
        otherLanguages
      );

      for (const [lang, translation] of Object.entries(googleTranslations)) {
        this.config.onTranslation({
          roomId: this.config.roomId,
          targetLanguage: lang,
          originalText: text,
          translatedText: translation,
          contextSummary: this.summary,
          timestamp: new Date(),
          sttTextId,
          confidence
        });
      }
    }
  }

  /**
   * 컨텍스트 버퍼 업데이트 (LLM 문맥용)
   */
  private updateContext(text: string): void {
    this.contextBuffer.push(text);

    if (this.contextBuffer.length > 6) {
      this.contextBuffer.shift();
    }

    console.log(`[TranslationManager][${this.config.roomId}] 📚 Context buffer: ${this.contextBuffer.length} items`);
  }

  /**
   * 요약 재생성
   */
  private async regenerateSummary(): Promise<void> {
    try {
      const recentText = this.contextBuffer.join(' ');
      const newSummary = await this.config.translationService.generateSummary(
        recentText,
        this.summary
      );

      if (newSummary) {
        this.summary = newSummary;
        console.log(`[TranslationManager][${this.config.roomId}] 📝 Summary updated: "${newSummary.substring(0, 100)}..."`);
      }
    } catch (error) {
      console.error(`[TranslationManager][${this.config.roomId}] ❌ Summary generation error:`, error);
    }
  }

  /**
   * 현재 상태 조회
   */
  getStatus(): {
    contextBufferSize: number;
    queueSize: number;
    transcriptCount: number;
    hasSummary: boolean;
  } {
    return {
      contextBufferSize: this.contextBuffer.length,
      queueSize: this.translationQueue.length,
      transcriptCount: this.transcriptCount,
      hasSummary: this.summary.length > 0,
    };
  }

  /**
   * 정리
   */
  async cleanup(): Promise<void> {
    console.log(`[TranslationManager][${this.config.roomId}] 🧹 Cleaning up...`);

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // 남은 번역 큐 처리
    if (this.translationQueue.length > 0) {
      console.log(`[TranslationManager][${this.config.roomId}] ⏳ Processing ${this.translationQueue.length} remaining items...`);

      const maxWaitTime = 10000;
      const startTime = Date.now();

      while (this.isProcessing && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (!this.isProcessing && this.translationQueue.length > 0) {
        await this.processTranslationBatch();
      }

      while (this.isProcessing && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    this.contextBuffer = [];
    this.translationQueue = [];
    this.summary = '';
    this.transcriptCount = 0;
    this.isProcessing = false;
    this.firstQueueItemTime = null;

    console.log(`[TranslationManager][${this.config.roomId}] ✅ Cleaned up`);
  }
}
