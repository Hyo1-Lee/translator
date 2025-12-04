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
 * - 슬라이딩 윈도우 (최근 10개 문장)
 * - 2.5초 배치 처리
 * - 이중 번역 (GPT + Google Translate)
 * - 30개마다 요약 생성
 */
export class TranslationManager {
  private config: TranslationManagerConfig;
  private contextBuffer: string[] = [];      // 최근 10개 문장
  private summary: string = '';              // 대화 요약
  private translationQueue: Array<{ text: string; confidence?: number }> = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private transcriptCount: number = 0;       // 요약 주기 계산용
  private isProcessing: boolean = false;     // 중복 처리 방지

  // 문장 병합 버퍼 (종결 부호 없는 조각들을 모음)
  private sentenceMergeBuffer: Array<{ text: string; confidence?: number }> = [];
  private sentenceMergeBufferTimer: NodeJS.Timeout | null = null;  // 버퍼 플러시 타이머
  private readonly SENTENCE_ENDINGS = /[.!?。！？]$/; // 문장 종결 부호
  private readonly BUFFER_FLUSH_TIMEOUT_MS = 1500; // 버퍼 플러시 대기 시간 (1.5초)

  // 버퍼 최대 대기 시간 (타이머 무한 리셋 방지)
  private firstBufferItemTime: number | null = null;
  private readonly BUFFER_MAX_WAIT_TIME_MS = 3000; // 버퍼 최대 3초 대기

  // 최대 대기 시간 추적 (타이머 무한 리셋 방지)
  private firstQueueItemTime: number | null = null;
  private readonly MAX_WAIT_TIME_MS = 1000; // 최대 1초 대기 (속도 최적화: 1500ms→1000ms)

  constructor(config: TranslationManagerConfig) {
    this.config = config;
    console.log(`[TranslationManager][${config.roomId}] 🚀 Initialized`);
    console.log(`[TranslationManager][${config.roomId}] Source: ${config.sourceLanguage}, Targets: ${config.targetLanguages.join(', ')}`);
    console.log(`[TranslationManager][${config.roomId}] Preset: ${config.environmentPreset}, Streaming: ${config.enableStreaming}`);
  }

  /**
   * Final transcript 추가 (문장 병합 + 적응형 배치 처리)
   */
  addTranscript(text: string, isFinal: boolean, confidence?: number): void {
    if (!isFinal) return;  // Final만 처리

    console.log(`[TranslationManager][${this.config.roomId}] ✅ Adding transcript: "${text.substring(0, 50)}..."`);

    // 문장 종결 부호 확인
    const hasSentenceEnding = this.SENTENCE_ENDINGS.test(text.trim());

    if (hasSentenceEnding) {
      // 완전한 문장!
      // 버퍼에 있던 조각들과 합치기
      let completeSentence = text;
      let avgConfidence = confidence;

      if (this.sentenceMergeBuffer.length > 0) {
        // 이전 조각들을 현재 텍스트 앞에 붙임
        const allParts = [...this.sentenceMergeBuffer, { text, confidence }];
        completeSentence = allParts.map(p => p.text).join(' ');

        // 평균 confidence 계산
        const confidences = allParts.filter(p => p.confidence !== undefined).map(p => p.confidence!);
        if (confidences.length > 0) {
          avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
        }

        console.log(`[TranslationManager][${this.config.roomId}] 🔗 Merged ${allParts.length} fragments into complete sentence: "${completeSentence.substring(0, 80)}..."`);

        // 버퍼 비우기
        this.sentenceMergeBuffer = [];

        // 버퍼 플러시 타이머 취소 (완전한 문장이 완성되었으므로)
        if (this.sentenceMergeBufferTimer) {
          clearTimeout(this.sentenceMergeBufferTimer);
          this.sentenceMergeBufferTimer = null;
        }
      }

      // 컨텍스트 버퍼 업데이트 (완전한 문장만)
      this.updateContext(completeSentence);

      // 번역 큐에 추가 (하나의 완전한 문장)
      this.translationQueue.push({ text: completeSentence, confidence: avgConfidence });

      // 완전한 문장이므로 빠르게 처리
      this.scheduleBatchProcessing(true);

      // 30개마다 요약 생성
      this.transcriptCount++;
      if (this.transcriptCount % 30 === 0) {
        console.log(`[TranslationManager][${this.config.roomId}] 📝 Generating summary (${this.transcriptCount} transcripts)`);
        this.regenerateSummary();
      }
    } else {
      // 불완전한 문장 조각 - 버퍼에 모으기
      console.log(`[TranslationManager][${this.config.roomId}] 📎 Incomplete fragment, buffering: "${text.substring(0, 50)}..."`);

      // 첫 번째 버퍼 아이템 시간 기록
      if (this.firstBufferItemTime === null) {
        this.firstBufferItemTime = Date.now();
      }

      this.sentenceMergeBuffer.push({ text, confidence });

      // 최대 대기 시간 체크 (타이머 무한 리셋 방지!)
      const bufferWaitTime = Date.now() - this.firstBufferItemTime;
      if (bufferWaitTime >= this.BUFFER_MAX_WAIT_TIME_MS) {
        console.log(`[TranslationManager][${this.config.roomId}] ⏰ Buffer max wait (${bufferWaitTime}ms) - forcing flush`);
        this.flushSentenceMergeBuffer();
        this.scheduleBatchProcessing(false);
        return;
      }

      // 버퍼 플러시 타이머 시작/리셋
      this.scheduleBufferFlush();

      // 버퍼가 너무 커지면 (5개 이상) 즉시 강제로 처리
      if (this.sentenceMergeBuffer.length >= 5) {
        console.log(`[TranslationManager][${this.config.roomId}] ⚠️  Buffer overflow (${this.sentenceMergeBuffer.length} fragments), forcing merge`);
        this.flushSentenceMergeBuffer();
        this.scheduleBatchProcessing(false);
      }
    }
  }

  /**
   * sentenceMergeBuffer 플러시 스케줄링
   * 불완전한 문장 조각이 일정 시간 동안 완성되지 않으면 강제로 번역 큐에 추가
   */
  private scheduleBufferFlush(): void {
    // 기존 타이머 취소
    if (this.sentenceMergeBufferTimer) {
      clearTimeout(this.sentenceMergeBufferTimer);
    }

    // 새로운 타이머 시작 (1.5초 후 플러시)
    this.sentenceMergeBufferTimer = setTimeout(() => {
      if (this.sentenceMergeBuffer.length > 0) {
        console.log(`[TranslationManager][${this.config.roomId}] ⏰ Buffer flush timeout - processing ${this.sentenceMergeBuffer.length} incomplete fragments`);
        this.flushSentenceMergeBuffer();
        this.scheduleBatchProcessing(false);
      }
    }, this.BUFFER_FLUSH_TIMEOUT_MS);
  }

  /**
   * sentenceMergeBuffer의 조각들을 번역 큐에 추가
   */
  private flushSentenceMergeBuffer(): void {
    if (this.sentenceMergeBuffer.length === 0) return;

    const forcedSentence = this.sentenceMergeBuffer.map(p => p.text).join(' ');
    const confidences = this.sentenceMergeBuffer.filter(p => p.confidence !== undefined).map(p => p.confidence!);
    const avgConfidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : undefined;

    console.log(`[TranslationManager][${this.config.roomId}] 🔗 Flushing ${this.sentenceMergeBuffer.length} fragments: "${forcedSentence.substring(0, 80)}..."`);

    this.updateContext(forcedSentence);
    this.translationQueue.push({ text: forcedSentence, confidence: avgConfidence });
    this.sentenceMergeBuffer = [];

    // 타이머 및 시간 추적 리셋
    this.firstBufferItemTime = null;
    if (this.sentenceMergeBufferTimer) {
      clearTimeout(this.sentenceMergeBufferTimer);
      this.sentenceMergeBufferTimer = null;
    }
  }

  /**
   * 적응형 배치 처리 스케줄링
   * - 큐가 3개 이상: 즉시 처리
   * - 최대 대기 시간 초과: 즉시 처리 (타이머 무한 리셋 방지!)
   * - 완전한 문장: 200ms (초고속)
   * - 불완전한 문장: 600ms (context 확보)
   */
  private scheduleBatchProcessing(isCompleteSentence: boolean = false): void {
    // 첫 번째 아이템이 큐에 추가된 시간 기록
    if (this.firstQueueItemTime === null && this.translationQueue.length > 0) {
      this.firstQueueItemTime = Date.now();
    }

    // 최대 대기 시간 체크 (타이머 무한 리셋 방지!)
    if (this.firstQueueItemTime !== null) {
      const waitTime = Date.now() - this.firstQueueItemTime;
      if (waitTime >= this.MAX_WAIT_TIME_MS) {
        console.log(`[TranslationManager][${this.config.roomId}] ⏰ Max wait time (${waitTime}ms) exceeded - forcing batch processing`);
        this.firstQueueItemTime = null;
        setImmediate(() => this.processTranslationBatch());
        return;
      }
    }

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // 큐가 많이 쌓이면 즉시 처리 (병목 방지)
    if (this.translationQueue.length >= 3) {
      console.log(`[TranslationManager][${this.config.roomId}] 🚨 Queue size (${this.translationQueue.length} items) - processing immediately`);
      this.firstQueueItemTime = null;
      setImmediate(() => this.processTranslationBatch());
      return;
    }

    // 적응형 딜레이: 완전한 문장이면 즉시, 아니면 조금 기다림 (속도 최적화)
    const delay = isCompleteSentence ? 0 : 150;  // 완전한 문장: 즉시 처리 (0ms), 불완전: 150ms

    if (isCompleteSentence) {
      console.log(`[TranslationManager][${this.config.roomId}] ⚡ Complete sentence - immediate processing`);
    }

    this.batchTimer = setTimeout(() => {
      this.firstQueueItemTime = null;
      this.processTranslationBatch();
    }, delay);
  }

  /**
   * 배치 번역 처리 (이중 번역 전략 + 스마트 배치)
   */
  private async processTranslationBatch(): Promise<void> {
    if (this.translationQueue.length === 0) return;
    if (this.isProcessing) {
      console.log(`[TranslationManager][${this.config.roomId}] ⏳ Already processing, queued items will be processed after current batch...`);
      return;
    }

    this.isProcessing = true;

    const batch = [...this.translationQueue];
    this.translationQueue = [];

    console.log(`[TranslationManager][${this.config.roomId}] 🔄 Processing batch of ${batch.length} items`);

    try {
      // Check if smart batch is available and batch size is suitable
      const useSmartBatch = batch.length >= 2 && typeof (this.config.translationService as any).translateBatch === 'function';

      if (useSmartBatch) {
        console.log(`[TranslationManager][${this.config.roomId}] ⚡ Using smart batch translation for ${batch.length} items`);
        await this.processBatchSmart(batch);
      } else {
        // Fallback to sequential processing
        console.log(`[TranslationManager][${this.config.roomId}] 🔄 Using sequential processing (batch too small or smart batch unavailable)`);
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

      // Reset first item time when batch is processed
      this.firstQueueItemTime = null;

      // Check if there are remaining items in queue and process them
      if (this.translationQueue.length > 0) {
        console.log(`[TranslationManager][${this.config.roomId}] 📦 ${this.translationQueue.length} items remaining in queue, processing next batch immediately...`);
        // Use setImmediate to avoid blocking and prevent stack overflow
        setImmediate(() => this.processTranslationBatch());
      }
    }
  }

  /**
   * 🚀 스마트 배치 처리: 여러 문장을 한 번의 LLM 호출로 번역
   */
  private async processBatchSmart(batch: Array<{ text: string; confidence?: number }>): Promise<void> {
    const recentContext = this.contextBuffer.slice(-5).join(' ');

    // 특수 케이스: 출발어가 영어면 Google Translate만 사용
    if (this.config.sourceLanguage === 'en') {
      console.log(`[TranslationManager][${this.config.roomId}] 🌐 English source, using Google Translate batch`);
      for (const item of batch) {
        await this.translateToMultipleLanguages(item.text, item.confidence);
      }
      return;
    }

    // Step 1: 여러 문장을 한 번에 영어로 번역 (스마트 배치!)
    console.log(`[TranslationManager][${this.config.roomId}] 🤖 Groq batch: ${this.config.sourceLanguage} → en (${batch.length} items in 1 API call)`);

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
      console.error(`[TranslationManager][${this.config.roomId}] ❌ Smart batch translation failed, falling back to sequential`);
      for (const item of batch) {
        await this.translateToMultipleLanguages(item.text, item.confidence);
      }
      return;
    }

    // Step 2: 각 번역 결과를 처리 (영어 + 다른 언어들)
    for (const result of batchResults) {
      const englishTranslation = result.translatedText;
      const originalText = result.originalText;
      const confidence = result.confidence;

      console.log(`[TranslationManager][${this.config.roomId}] ✅ English: "${englishTranslation.substring(0, 50)}..."`);

      // 영어 번역 전송 (DB 저장 포함)
      this.config.onTranslation({
        roomId: this.config.roomId,
        targetLanguage: 'en',
        originalText,
        translatedText: englishTranslation,
        isPartial: false,
        contextSummary: this.summary,
        timestamp: new Date(),
        sttTextId: undefined,  // Will trigger DB save
        confidence
      });

      // Step 3: 영어 → 다른 언어들 (Google Translate)
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
            originalText,
            translatedText: translation,
            contextSummary: this.summary,
            timestamp: new Date(),
            sttTextId: 'saved',  // Skip DB save (already saved with English)
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
          timestamp: new Date(),
          sttTextId,  // First translation will have sttTextId
          confidence
        });

        // Mark that STT was saved (for first translation only)
        if (!sttTextId) {
          sttTextId = 'saved';  // Placeholder to indicate DB save happened
        }
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

    // 영어 번역 결과 전송 (최종) - First translation, will save STT text
    this.config.onTranslation({
      roomId: this.config.roomId,
      targetLanguage: 'en',
      originalText: text,
      translatedText: englishTranslation,
      isPartial: false,
      contextSummary: this.summary,
      timestamp: new Date(),
      sttTextId,  // undefined for first translation (will trigger DB save)
      confidence
    });

    // Mark that STT was saved
    sttTextId = 'saved';  // Placeholder to indicate DB save happened

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
          timestamp: new Date(),
          sttTextId,  // 'saved' for subsequent translations (skip DB save)
          confidence
        });
      }
    }
  }

  /**
   * 컨텍스트 버퍼 업데이트
   */
  private updateContext(text: string): void {
    this.contextBuffer.push(text);

    // 최대 6개 유지 (실제 사용은 5개 - 메모리/토큰 최적화)
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
   * 정리 (async로 변경 - 마지막 번역 완료 보장)
   */
  async cleanup(): Promise<void> {
    console.log(`[TranslationManager][${this.config.roomId}] 🧹 Cleaning up...`);

    // 모든 타이머 먼저 정리 (새로운 스케줄링 방지)
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.sentenceMergeBufferTimer) {
      clearTimeout(this.sentenceMergeBufferTimer);
      this.sentenceMergeBufferTimer = null;
    }

    // 버퍼에 남아있는 조각들 강제 처리
    if (this.sentenceMergeBuffer.length > 0) {
      console.log(`[TranslationManager][${this.config.roomId}] 📦 Flushing ${this.sentenceMergeBuffer.length} remaining fragments`);
      this.flushSentenceMergeBuffer();
    }

    // ⚠️ 중요: 남은 번역 큐를 완전히 처리할 때까지 대기!
    if (this.translationQueue.length > 0) {
      console.log(`[TranslationManager][${this.config.roomId}] ⏳ Processing ${this.translationQueue.length} remaining items before cleanup...`);

      // isProcessing이 false가 될 때까지 대기 (최대 10초)
      const maxWaitTime = 10000;
      const startTime = Date.now();

      while (this.isProcessing && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // 남은 큐 처리 (await으로 완료 보장!)
      if (!this.isProcessing && this.translationQueue.length > 0) {
        await this.processTranslationBatch();
      }

      // 다시 대기 (방금 시작한 배치 처리 완료 대기)
      while (this.isProcessing && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // 모든 처리 완료 후 정리
    this.contextBuffer = [];
    this.translationQueue = [];
    this.sentenceMergeBuffer = [];
    this.summary = '';
    this.transcriptCount = 0;
    this.isProcessing = false;
    this.firstQueueItemTime = null;
    this.firstBufferItemTime = null;

    console.log(`[TranslationManager][${this.config.roomId}] ✅ Cleaned up (all translations completed)`);
  }
}
