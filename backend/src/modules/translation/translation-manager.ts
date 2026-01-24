import { TranslationService } from './translation-service';
import { AzureTranslateService } from './azure-translate.service';
import { EnvironmentPreset } from './presets';

// Note: AzureTranslateService is kept for potential fallback but LLM is now primary

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
  azureTranslateService: AzureTranslateService;  // Azure (영어 → 다국어)
  onTranslation: (data: TranslationData) => void;  // 콜백
  onError?: (error: Error) => void;  // 에러 콜백
}

/**
 * 번역 결과 데이터 (단일 언어)
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
  // Batch mode: all translations at once
  translations?: Record<string, string>;  // {en: "...", ja: "...", zh: "..."}
  isBatch?: boolean;
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
  private previousTranslations: Record<string, string> = {};  // 이전 번역들 (언어별 문장 연속성용)
  private batchTimer: NodeJS.Timeout | null = null;
  private transcriptCount: number = 0;       // 요약 주기 계산용
  private isProcessing: boolean = false;     // 중복 처리 방지

  // 번역 큐 배치 설정
  private firstQueueItemTime: number | null = null;
  private readonly MIN_BATCH_SIZE = 3;        // 최소 배치 크기
  private readonly MAX_WAIT_TIME_MS = 5000;   // 최대 5초 대기
  private readonly BATCH_DELAY_MS = 1200;     // 기본 딜레이 (1.2초)
  private readonly RETRY_DELAY_MS = 800;      // 재시도 딜레이 (0.8초)

  constructor(config: TranslationManagerConfig) {
    this.config = config;
  }

  /**
   * Final transcript 추가 - Deepgram에서 이미 문장 완성 판단했으므로 바로 번역 큐에 추가
   */
  addTranscript(text: string, isFinal: boolean, confidence?: number): void {
    if (!isFinal) {
      return;  // Final만 처리
    }

    // 컨텍스트 버퍼 업데이트 (LLM 문맥용)
    this.updateContext(text);

    // 번역 큐에 추가
    this.translationQueue.push({ text, confidence });

    // 배치 처리 스케줄링
    this.scheduleBatchProcessing();

    // 30개마다 요약 생성
    this.transcriptCount++;
    if (this.transcriptCount % 30 === 0) {
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

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // 큐가 3개 이상이면 즉시 처리
    if (this.translationQueue.length >= 3) {
      this.firstQueueItemTime = null;
      setImmediate(() => this.processTranslationBatch());
      return;
    }

    // 딜레이 후 배치 처리
    this.batchTimer = setTimeout(() => {
      this.checkAndProcessBatch();
    }, this.BATCH_DELAY_MS);
  }

  /**
   * 배치 처리 조건 체크 및 실행
   */
  private checkAndProcessBatch(): void {
    if (this.translationQueue.length === 0) return;

    const waitTime = this.firstQueueItemTime ? Date.now() - this.firstQueueItemTime : 0;

    // 최대 대기 시간 초과 → 무조건 flush
    if (waitTime >= this.MAX_WAIT_TIME_MS) {
      this.firstQueueItemTime = null;
      this.processTranslationBatch();
      return;
    }

    // 최소 배치 크기 미달 → 추가 대기
    if (this.translationQueue.length < this.MIN_BATCH_SIZE) {
      this.batchTimer = setTimeout(() => {
        this.checkAndProcessBatch();
      }, this.RETRY_DELAY_MS);
      return;
    }

    // 조건 충족 → 처리
    this.firstQueueItemTime = null;
    this.processTranslationBatch();
  }

  /**
   * 배치 번역 처리
   */
  private async processTranslationBatch(): Promise<void> {
    if (this.translationQueue.length === 0) return;
    if (this.isProcessing) return;

    this.isProcessing = true;

    const batch = [...this.translationQueue];
    this.translationQueue = [];

    try {
      const useSmartBatch = batch.length >= 2 && typeof (this.config.translationService as any).translateBatch === 'function';

      if (useSmartBatch) {
        await this.processBatchSmart(batch);
      } else {
        for (const item of batch) {
          await this.translateToMultipleLanguages(item.text, item.confidence);
        }
      }
    } catch (error) {
      console.error(`[TranslationManager] Batch error:`, error);
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
   * 스마트 배치 처리: 여러 문장을 한 번의 LLM 호출로 번역 후 합쳐서 전송
   * LLM 다국어 번역으로 전환 (Azure 제거)
   */
  private async processBatchSmart(batch: Array<{ text: string; confidence?: number }>): Promise<void> {
    const recentContext = this.contextBuffer.slice(-5).join(' ');
    const combinedOriginal = batch.map(b => b.text).join(' ');
    const avgConfidence = batch.reduce((sum, b) => sum + (b.confidence || 0), 0) / batch.length;

    // LLM 다국어 번역 사용
    const allTranslations = await this.config.translationService.translateWithPresetMultiLanguage(
      combinedOriginal,
      recentContext,
      this.summary,
      this.config.sourceLanguage,
      this.config.targetLanguages,
      this.config.environmentPreset,
      this.config.customEnvironmentDescription,
      this.config.customGlossary,
      this.previousTranslations
    );

    if (Object.keys(allTranslations).length === 0) {
      console.error(`[TranslationManager] Smart batch LLM translation failed`);
      return;
    }

    // 이전 번역들 저장 (다음 배치에서 문장 연속성 유지용)
    this.previousTranslations = { ...this.previousTranslations, ...allTranslations };

    // 모든 번역을 한 번에 전송 (배치)
    const primaryLang = this.config.targetLanguages[0] || 'en';
    this.config.onTranslation({
      roomId: this.config.roomId,
      targetLanguage: primaryLang,
      originalText: combinedOriginal,
      translatedText: allTranslations[primaryLang] || '',
      isPartial: false,
      contextSummary: this.summary,
      timestamp: new Date(),
      sttTextId: undefined,
      confidence: avgConfidence,
      translations: allTranslations,
      isBatch: true
    });
  }

  /**
   * LLM 다국어 번역 (Azure 제거, LLM 직접 번역)
   * 모든 번역을 한 번에 배치로 전송
   */
  private async translateToMultipleLanguages(
    text: string,
    confidence?: number
  ): Promise<void> {
    const recentContext = this.contextBuffer.slice(-5).join(' ');

    // LLM 다국어 번역 사용
    const allTranslations = await this.config.translationService.translateWithPresetMultiLanguage(
      text,
      recentContext,
      this.summary,
      this.config.sourceLanguage,
      this.config.targetLanguages,
      this.config.environmentPreset,
      this.config.customEnvironmentDescription,
      this.config.customGlossary,
      this.previousTranslations
    );

    if (Object.keys(allTranslations).length === 0) {
      console.error(`[TranslationManager][${this.config.roomId}] Failed to translate`);
      if (this.config.onError) {
        this.config.onError(new Error('Failed to translate'));
      }
      return;
    }

    // 이전 번역들 저장 (다음 번역에서 문장 연속성 유지용)
    this.previousTranslations = { ...this.previousTranslations, ...allTranslations };

    // 모든 번역을 한 번에 배치로 전송
    const primaryLang = this.config.targetLanguages[0] || 'en';
    this.config.onTranslation({
      roomId: this.config.roomId,
      targetLanguage: primaryLang,
      originalText: text,
      translatedText: allTranslations[primaryLang] || '',
      isPartial: false,
      contextSummary: this.summary,
      timestamp: new Date(),
      confidence,
      translations: allTranslations,
      isBatch: true
    });
  }

  /**
   * 컨텍스트 버퍼 업데이트 (LLM 문맥용)
   */
  private updateContext(text: string): void {
    this.contextBuffer.push(text);

    if (this.contextBuffer.length > 6) {
      this.contextBuffer.shift();
    }
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
      }
    } catch (error) {
      console.error(`[TranslationManager] Summary generation error:`, error);
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
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // 남은 번역 큐 처리
    if (this.translationQueue.length > 0) {
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
    this.previousTranslations = {};
  }
}
