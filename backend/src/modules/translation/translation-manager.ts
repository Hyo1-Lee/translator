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
}

/**
 * TranslationManager
 *
 * 실시간 문맥 유지 번역 관리자
 * - 슬라이딩 윈도우 (최근 10개 문장)
 * - 2.5초 배치 처리
 * - 이중 번역 (GPT + Google Translate)
 * - 30개마다 요약 생성
 */
export class TranslationManager {
  private config: TranslationManagerConfig;
  private contextBuffer: string[] = [];      // 최근 10개 문장
  private summary: string = '';              // 대화 요약
  private translationQueue: Array<{ text: string; sttTextId?: string }> = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private transcriptCount: number = 0;       // 요약 주기 계산용
  private isProcessing: boolean = false;     // 중복 처리 방지

  constructor(config: TranslationManagerConfig) {
    this.config = config;
    console.log(`[TranslationManager][${config.roomId}] 🚀 Initialized`);
    console.log(`[TranslationManager][${config.roomId}] Source: ${config.sourceLanguage}, Targets: ${config.targetLanguages.join(', ')}`);
    console.log(`[TranslationManager][${config.roomId}] Preset: ${config.environmentPreset}, Streaming: ${config.enableStreaming}`);
  }

  /**
   * Final transcript 추가 (2-3초 배치 처리)
   */
  addTranscript(text: string, isFinal: boolean, sttTextId?: string): void {
    if (!isFinal) return;  // Final만 처리

    console.log(`[TranslationManager][${this.config.roomId}] ✅ Adding transcript: "${text.substring(0, 50)}..."`);

    // 컨텍스트 버퍼 업데이트
    this.updateContext(text);

    // 번역 큐에 추가
    this.translationQueue.push({ text, sttTextId });

    // 배치 타이머 시작 (2.5초 후 처리)
    this.scheduleBatchProcessing();

    // 30개마다 요약 생성
    this.transcriptCount++;
    if (this.transcriptCount % 30 === 0) {
      console.log(`[TranslationManager][${this.config.roomId}] 📝 Generating summary (${this.transcriptCount} transcripts)`);
      this.regenerateSummary();
    }
  }

  /**
   * 2.5초 배치 처리 스케줄링
   */
  private scheduleBatchProcessing(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.processTranslationBatch();
    }, 2500);  // 2.5초
  }

  /**
   * 배치 번역 처리 (이중 번역 전략)
   */
  private async processTranslationBatch(): Promise<void> {
    if (this.translationQueue.length === 0) return;
    if (this.isProcessing) {
      console.log(`[TranslationManager][${this.config.roomId}] ⏳ Already processing, skipping...`);
      return;
    }

    this.isProcessing = true;

    const batch = [...this.translationQueue];
    this.translationQueue = [];

    console.log(`[TranslationManager][${this.config.roomId}] 🔄 Processing batch of ${batch.length} items`);

    try {
      for (const item of batch) {
        await this.translateToMultipleLanguages(item.text, item.sttTextId);
      }
    } catch (error) {
      console.error(`[TranslationManager][${this.config.roomId}] ❌ Batch processing error:`, error);
      if (this.config.onError) {
        this.config.onError(error as Error);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 이중 번역: 출발어 → 영어 (GPT) → 다국어 (Google Translate)
   */
  private async translateToMultipleLanguages(
    text: string,
    sttTextId?: string
  ): Promise<void> {
    const recentContext = this.contextBuffer.slice(-5).join(' ');

    // 특수 케이스: 출발어가 영어면 Google Translate만 사용
    if (this.config.sourceLanguage === 'en') {
      console.log(`[TranslationManager][${this.config.roomId}] 🌐 English source detected, using Google Translate only`);

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
          timestamp: new Date()
        });
      }
      return;
    }

    // Step 1: 출발어 → 영어 (GPT, 고품질, 문맥 이해)
    console.log(`[TranslationManager][${this.config.roomId}] 🤖 GPT: ${this.config.sourceLanguage} → en`);

    let englishTranslation: string | null = null;

    if (this.config.enableStreaming) {
      // 스트리밍 번역
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
          // 스트리밍 중간 결과 전송
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
      // 일반 번역
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

    console.log(`[TranslationManager][${this.config.roomId}] ✅ English translation: "${englishTranslation.substring(0, 50)}..."`);

    // 영어 번역 결과 전송 (최종)
    this.config.onTranslation({
      roomId: this.config.roomId,
      targetLanguage: 'en',
      originalText: text,
      translatedText: englishTranslation,
      isPartial: false,
      contextSummary: this.summary,
      timestamp: new Date()
    });

    // Step 2: 영어 → 다른 언어들 (Google Translate, 빠르고 저렴)
    const otherLanguages = this.config.targetLanguages.filter(lang => lang !== 'en');

    if (otherLanguages.length > 0) {
      console.log(`[TranslationManager][${this.config.roomId}] 🌐 Google Translate: en → [${otherLanguages.join(', ')}]`);

      const googleTranslations = await this.config.googleTranslateService.translateToMultipleLanguages(
        englishTranslation,
        otherLanguages
      );

      for (const [lang, translation] of Object.entries(googleTranslations)) {
        console.log(`[TranslationManager][${this.config.roomId}] ✅ ${lang}: "${translation.substring(0, 50)}..."`);

        this.config.onTranslation({
          roomId: this.config.roomId,
          targetLanguage: lang,
          originalText: text,
          translatedText: translation,
          contextSummary: this.summary,
          timestamp: new Date()
        });
      }
    }
  }

  /**
   * 컨텍스트 버퍼 업데이트
   */
  private updateContext(text: string): void {
    this.contextBuffer.push(text);

    // 최대 10개 유지
    if (this.contextBuffer.length > 10) {
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
  cleanup(): void {
    console.log(`[TranslationManager][${this.config.roomId}] 🧹 Cleaning up...`);

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    this.contextBuffer = [];
    this.translationQueue = [];
    this.summary = '';
    this.transcriptCount = 0;
    this.isProcessing = false;

    console.log(`[TranslationManager][${this.config.roomId}] ✅ Cleaned up`);
  }
}
