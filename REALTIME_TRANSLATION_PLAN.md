# 실시간 문맥 유지 번역 시스템 개선 계획

## 📋 현재 상황 분석

### ✅ 구현된 기능
- **STT**: Deepgram을 통한 실시간 음성→텍스트 변환 (한국어)
- **TranslationService**: OpenAI GPT API를 사용한 번역 서비스 (구현되어 있으나 미사용)
- **문맥 기반 번역**: `translateWithContext()` 함수 이미 구현됨
- **STT 오류 수정**: 종교 용어 특화 오류 수정 로직
- **요약 생성**: `generateSummary()` 함수로 대화 요약 가능
- **LDS 교회 특화**: 종교 용어 사전 및 프롬프트 준비됨

### ❌ 문제점
1. **번역 미연결**: TranslationService가 구현되어 있으나 실제로 사용되지 않음
2. **실시간성 부족**: 이전 큐 방식은 실시간 응답 지연
3. **문맥 단절**: 큐 단위로 처리하면 앞뒤 문맥이 사라짐
4. **STT 오류 누적**: 단일 문장 번역 시 STT 오류로 인한 오역 발생
5. **범용성 부족**: 현재는 LDS 교회에만 특화, 다른 도메인 지원 필요

---

## 🎯 목표

1. **실시간성**: STT 결과가 나오면 2-3초 이내에 번역 제공 ✅ **확정**
2. **문맥 유지**: 전체 대화의 흐름을 이해하고 일관된 번역 제공
3. **높은 정확도**: STT 오류를 수정하고 도메인 특화 용어를 정확히 번역
4. **토큰 효율성**: 비용 최적화를 위한 프롬프트 및 컨텍스트 관리
5. **범용성**: 교회/의료/법률/비즈니스 등 다양한 도메인 지원 ✅ **확정**
6. **다국어**: 사용자가 번역 언어 선택 가능 (기본값: 영어) ✅ **확정**

---

## 🏗️ 제안 아키텍처

### 0. 이중 번역 전략 (GPT + Google Translate)

**핵심 아이디어**: 영어를 "피벗 언어"로 사용

```
[한국어 STT]
    ↓
[GPT API] 한국어 → 영어 (고품질, 문맥 이해, STT 오류 수정)
    ↓
[영어 번역] (Primary translation)
    ↓
[Google Translate API] 영어 → 다국어 (빠르고 저렴)
    ↓
[일본어, 중국어, 스페인어, ...]
```

**장점**:
- ✅ **비용 절감**: GPT는 한국어→영어 1번만, 나머지는 Google Translate (80-90% 절감)
- ✅ **높은 품질**: 한국어→영어는 GPT로 STT 오류 수정 + 문맥 이해
- ✅ **빠른 속도**: 영어 완료 후 Google Translate로 동시 다국어 번역
- ✅ **단순성**: GPT는 한국어→영어에만 집중, 복잡도 감소
- ✅ **확장성**: 영어→다른 언어는 Google Translate가 지원하는 100+ 언어 가능

**기존 코드 활용**:
- `google-translate.service.ts` 이미 구현되어 있음
- `translateToMultipleLanguages()` 함수 사용

**비용 비교** (1시간 설교, 200회 번역 기준):
- 기존 (GPT 직접): 200회 × 5개 언어 × $0.0015 = **$1.50**
- 개선 (GPT + Google): 200회 × $0.0015 + (200 × 50단어 × 5개 언어 × $0.00002) = **$0.30 + $0.10 = $0.40**
- **절감**: 약 73%

---

### 1. 슬라이딩 윈도우 + 요약 기반 컨텍스트 전략

```
[오래된 대화] → [요약] → [최근 5-10문장] → [현재 번역할 문장]
     ↓              ↓           ↓                    ↓
  자동 요약    토큰 절약    세밀한 문맥         번역 대상
```

#### 컨텍스트 계층 구조
- **요약 (Summary)**: 전체 대화의 주제 및 핵심 내용 (100-200 토큰)
- **최근 컨텍스트 (Recent Context)**: 최근 5-10개 final transcript (500-1000 토큰)
- **현재 문장 (Current)**: 번역할 문장 (50-200 토큰)

#### 업데이트 전략
- **Final transcript 수신 시**:
  1. 최근 컨텍스트 버퍼에 추가
  2. 번역 큐에 추가 (즉시 또는 배치)
  3. 버퍼 크기 확인 → 10문장 초과 시 가장 오래된 것 제거

- **20-30개 문장 누적 시**:
  1. 요약 생성 또는 업데이트
  2. 오래된 컨텍스트 삭제

### 2. 번역 처리 방식

**Option A: 즉시 번역 (낮은 지연시간)**
- Final transcript 올 때마다 즉시 번역 요청
- 장점: 최저 지연시간 (~200-500ms)
- 단점: API 호출 횟수 증가, 비용 증가

**Option B: 마이크로 배치 (균형)**
- 2-3초마다 또는 2-3개 문장마다 배치 번역
- 장점: 실시간성 유지 + 비용 절감
- 단점: 약간의 지연 (2-3초)

**Option C: 스마트 배치 (최적화)**
- 문장 끝 감지 시 즉시 번역 (마침표, 물음표 등)
- 문장 중간이면 짧은 대기 (1-2초)
- 장점: 자연스러운 번역 타이밍
- 단점: 복잡한 로직

---

## 🎛️ 프리셋 시스템 (도메인 특화)

### 개요
범용적 사용을 위해 도메인별 프리셋을 제공하면서도, 사용자가 커스텀 설정을 할 수 있게 함.

### 프리셋 종류

#### 1. **LDS Church** (교회 - MVP 테스트 대상)
- **환경**: "LDS/Mormon church sermon or talk"
- **특화 용어**:
  - 몰몬경 = Book of Mormon
  - 구주 = Savior
  - 속죄 = Atonement
  - 간증 = testimony
  - 성신 = Holy Ghost
  - 제일회장단 = First Presidency
  - 선지자 = prophet
  - 감독 = bishop
- **톤**: 격식있고 경건한

#### 2. **Medical** (의료)
- **환경**: "Medical conference or clinical discussion"
- **특화 용어**:
  - 진단 = diagnosis
  - 치료 = treatment
  - 환자 = patient
  - 증상 = symptoms
  - 처방 = prescription
- **톤**: 전문적이고 정확한

#### 3. **Legal** (법률)
- **환경**: "Legal proceedings or court hearing"
- **특화 용어**:
  - 피고인 = defendant
  - 원고 = plaintiff
  - 판사 = judge
  - 증거 = evidence
  - 판결 = verdict
- **톤**: 격식있고 정확한

#### 4. **Business** (비즈니스)
- **환경**: "Business meeting or corporate presentation"
- **특화 용어**:
  - 매출 = revenue
  - 이익 = profit
  - 전략 = strategy
  - 시장 = market
- **톤**: 전문적이고 간결한

#### 5. **General** (일반)
- **환경**: "General conversation or presentation"
- **특화 용어**: 없음
- **톤**: 자연스럽고 일상적인

#### 6. **Custom** (커스텀)
- **환경**: 사용자가 직접 입력 (예: "University lecture on quantum physics")
- **특화 용어**: 사용자가 직접 입력 (JSON 형식)
- **톤**: 환경 설명에 따라 조정

### 데이터베이스 스키마 확장

```typescript
// RoomSettings 테이블 확장
interface RoomSettings {
  // 기존 필드들...
  promptTemplate: string;

  // 새로운 필드들
  sourceLanguage?: string;  // 출발 언어 (기본: 'ko' 한국어)
  environmentPreset?: 'church' | 'medical' | 'legal' | 'business' | 'general' | 'custom';
  customEnvironmentDescription?: string;  // preset이 'custom'일 때
  customGlossary?: Record<string, string>;  // 사용자 정의 용어집
  targetLanguages?: string[];  // ['en', 'ja', 'zh'] 등
  enableStreaming?: boolean;  // 스트리밍 번역 여부
}
```

**지원 출발 언어**:
- `ko`: 한국어 (기본값)
- `ja`: 일본어
- `en`: 영어 (Google Translate만 사용)
- `zh`: 중국어 (간체)
- `es`: 스페인어
- 등...

### 동적 프롬프트 생성

```typescript
function buildTranslationPrompt(
  preset: EnvironmentPreset,
  customEnv?: string,
  customGlossary?: Record<string, string>,
  targetLang: string = 'en'
): string {
  const presetConfig = PRESETS[preset];
  const environment = preset === 'custom' ? customEnv : presetConfig.environment;
  const glossary = preset === 'custom' ? customGlossary : presetConfig.glossary;

  return `You are an expert Korean-to-${targetLang} interpreter.

CONTEXT: ${environment}

TASK: Translate the current segment, fixing STT errors and maintaining context.

${glossary ? `KEY TERMS:\n${formatGlossary(glossary)}\n` : ''}

RULES:
1. Fix obvious STT errors using context
2. Maintain ${presetConfig.tone} tone
3. Translate concisely
4. Output ONLY the translation

CONTEXT:
Summary: {summary}
Recent: {recentContext}

CURRENT: {currentText}

OUTPUT: [translation only]`;
}
```

### 프리셋 정의 파일

```typescript
// src/modules/translation/presets.ts
export const PRESETS = {
  church: {
    environment: "LDS/Mormon church sermon or religious talk",
    glossary: {
      "몰몬경": "Book of Mormon",
      "구주": "Savior",
      "속죄": "Atonement",
      // ... 20-30개 핵심 용어
    },
    tone: "formal and reverent"
  },
  medical: {
    environment: "Medical conference or clinical discussion",
    glossary: {
      "진단": "diagnosis",
      "치료": "treatment",
      // ...
    },
    tone: "professional and precise"
  },
  // ... 나머지 프리셋들
};
```

### UI 플로우 (프론트엔드)

```
Room 생성/설정 화면
  ↓
[출발 언어 선택] ✨ 새로 추가
  - Korean (한국어) - 기본값
  - Japanese (日本語)
  - English
  - Chinese (中文)
  - Spanish (Español)
  - etc.
  ↓
[환경 선택]
  - LDS Church (추천 - MVP)
  - Medical
  - Legal
  - Business
  - General
  - Custom
  ↓
[Custom 선택 시]
  - 환경 설명 입력 (텍스트박스)
  - 용어집 추가 (옵션)
  ↓
[번역 대상 언어 선택] (멀티셀렉트)
  - English (기본)
  - Japanese
  - Chinese (Simplified)
  - Chinese (Traditional)
  - Spanish
  - Korean
  - etc.
  ↓
저장
```

**출발 언어에 따른 번역 전략**:
- 출발어 = 영어 → Google Translate만 (영어→다국어)
- 출발어 ≠ 영어 → GPT (출발어→영어) + Google (영어→다국어)

---

## 🔧 구현 세부사항

### 새로운 모듈: `TranslationManager`

```typescript
interface TranslationManagerConfig {
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
}

interface TranslationData {
  roomId: string;
  targetLanguage: string;
  originalText: string;
  translatedText: string;
  isPartial?: boolean;  // 스트리밍 중간 결과
  timestamp: Date;
}

class TranslationManager {
  private config: TranslationManagerConfig;
  private contextBuffer: string[] = [];      // 최근 10개 문장
  private summary: string = '';              // 대화 요약
  private translationQueue: Array<{text: string, sttTextId?: string}> = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private transcriptCount: number = 0;       // 요약 주기 계산용

  constructor(config: TranslationManagerConfig) {
    this.config = config;
  }

  // Final transcript 추가 (2-3초 배치 처리)
  addTranscript(text: string, isFinal: boolean, sttTextId?: string): void {
    if (!isFinal) return;  // Final만 처리

    // 컨텍스트 버퍼 업데이트
    this.updateContext(text);

    // 번역 큐에 추가
    this.translationQueue.push({ text, sttTextId });

    // 배치 타이머 시작 (2-3초 후 처리)
    this.scheduleBatchProcessing();

    // 30개마다 요약 생성
    this.transcriptCount++;
    if (this.transcriptCount % 30 === 0) {
      this.regenerateSummary();
    }
  }

  // 2-3초 배치 처리 스케줄링
  private scheduleBatchProcessing(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.processTranslationBatch();
    }, 2500);  // 2.5초
  }

  // 배치 번역 처리 (이중 번역 전략)
  private async processTranslationBatch(): Promise<void> {
    if (this.translationQueue.length === 0) return;

    const batch = [...this.translationQueue];
    this.translationQueue = [];

    for (const item of batch) {
      await this.translateToMultipleLanguages(item.text, item.sttTextId);
    }
  }

  // 이중 번역: 출발어 → 영어 (GPT) → 다국어 (Google Translate)
  private async translateToMultipleLanguages(
    text: string,
    sttTextId?: string
  ): Promise<void> {
    const recentContext = this.contextBuffer.slice(-5).join(' ');

    // 특수 케이스: 출발어가 영어면 Google Translate만 사용
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
          timestamp: new Date()
        });
      }
      return;
    }

    // Step 1: 출발어 → 영어 (GPT, 고품질, 문맥 이해)
    let englishTranslation: string | null;

    if (this.config.enableStreaming) {
      englishTranslation = await this.translateWithStreaming(text, 'en', recentContext, sttTextId);
    } else {
      englishTranslation = await this.config.translationService.translateWithContext(
        text,
        recentContext,
        this.summary,
        'en'
      );
    }

    if (!englishTranslation) {
      console.error('[TranslationManager] Failed to translate to English');
      return;
    }

    // 영어 번역 결과 전송
    this.config.onTranslation({
      roomId: this.config.roomId,
      targetLanguage: 'en',
      originalText: text,
      translatedText: englishTranslation,
      timestamp: new Date()
    });

    // Step 2: 영어 → 다른 언어들 (Google Translate, 빠르고 저렴)
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
          originalText: text,
          translatedText: translation,
          timestamp: new Date()
        });
      }
    }
  }

  // 스트리밍 번역 (한국어 → 영어만)
  private async translateWithStreaming(
    text: string,
    targetLang: string,  // 'en' only
    recentContext: string,
    sttTextId?: string
  ): Promise<string | null> {
    // OpenAI 스트리밍 API 호출
    // 점진적으로 번역 결과를 받아서 onTranslation 콜백 호출
    // isPartial: true로 중간 결과 전송
    // 완료되면 isPartial: false로 최종 결과 전송 및 반환
    return null;  // 구현 필요
  }

  // 컨텍스트 버퍼 업데이트
  private updateContext(text: string): void {
    this.contextBuffer.push(text);

    // 최대 10개 유지
    if (this.contextBuffer.length > 10) {
      this.contextBuffer.shift();
    }
  }

  // 요약 재생성
  private async regenerateSummary(): Promise<void> {
    const recentText = this.contextBuffer.join(' ');
    const newSummary = await this.config.translationService.generateSummary(
      recentText,
      this.summary
    );

    if (newSummary) {
      this.summary = newSummary;
    }
  }

  // 정리
  cleanup(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    this.contextBuffer = [];
    this.translationQueue = [];
  }
}
```

### 통합 플로우

```
[사용자] Room 생성
       ↓
  환경 프리셋 선택 (교회/의료/법률/일반/커스텀)
  + 번역 언어 선택 (영어, 일본어 등)
       ↓
[SocketHandler] createRoom
       ↓
  TranslationManager 생성 (프리셋 설정 포함)
       ↓
[Deepgram STT] 실시간 음성 인식
       ↓
  Final transcript 이벤트
       ↓
[TranslationManager.addTranscript()]
       ↓
  1. 컨텍스트 버퍼 업데이트 (최근 10개)
  2. 번역 큐에 추가
  3. 2.5초 타이머 시작
  4. 30개마다 요약 재생성
       ↓
[타이머 만료] 2.5초 후
       ↓
[processTranslationBatch()]
       ↓
  각 대상 언어별로:
    1. 프리셋 기반 프롬프트 생성
    2. 요약 + 최근 컨텍스트 + 현재 문장
    3. TranslationService.translateWithContext()
       ↓
    [스트리밍 활성화 시]
    점진적 번역 결과 (isPartial: true)
       ↓
    최종 번역 결과 (isPartial: false)
       ↓
  번역 결과 → Socket broadcast ('translation-text')
       ↓
  데이터베이스 저장
       ↓
[프론트엔드] 번역 텍스트 표시
```

### 데이터베이스 스키마 확장

#### 1. RoomSettings 테이블 수정 (Sequelize 마이그레이션)

```typescript
// src/models/RoomSettings.ts 확장
export class RoomSettings extends Model {
  // 기존 필드들...
  declare promptTemplate: string;

  // 새로운 필드들
  declare environmentPreset: 'church' | 'medical' | 'legal' | 'business' | 'general' | 'custom';
  declare customEnvironmentDescription: string | null;
  declare customGlossary: object | null;  // JSON
  declare targetLanguages: string[];  // JSON array
  declare enableStreaming: boolean;
}
```

**마이그레이션 SQL**:
```sql
ALTER TABLE room_settings
ADD COLUMN source_language VARCHAR(10) DEFAULT 'ko',
ADD COLUMN environment_preset VARCHAR(20) DEFAULT 'general',
ADD COLUMN custom_environment_description TEXT,
ADD COLUMN custom_glossary JSON,
ADD COLUMN target_languages JSON DEFAULT '["en"]',
ADD COLUMN enable_streaming BOOLEAN DEFAULT true;
```

#### 2. TranslationText 테이블 추가

```sql
CREATE TABLE translation_texts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  stt_text_id UUID REFERENCES stt_texts(id) ON DELETE SET NULL,
  target_language VARCHAR(10) NOT NULL,
  translated_text TEXT NOT NULL,
  context_summary TEXT,
  is_partial BOOLEAN DEFAULT false,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_room_lang (room_id, target_language),
  INDEX idx_timestamp (timestamp)
);
```

**Sequelize Model**:
```typescript
// src/models/TranslationText.ts
import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Room } from './Room';
import { SttText } from './SttText';

@Table({
  tableName: 'translation_texts',
  timestamps: false,
  underscored: true,
})
export class TranslationText extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => Room)
  @Column(DataType.UUID)
  declare roomId: string;

  @ForeignKey(() => SttText)
  @Column(DataType.UUID)
  declare sttTextId: string | null;

  @Column(DataType.STRING(10))
  declare targetLanguage: string;

  @Column(DataType.TEXT)
  declare translatedText: string;

  @Column(DataType.TEXT)
  declare contextSummary: string | null;

  @Default(false)
  @Column(DataType.BOOLEAN)
  declare isPartial: boolean;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare timestamp: Date;

  // Relations
  @BelongsTo(() => Room)
  declare room: Room;

  @BelongsTo(() => SttText)
  declare sttText: SttText | null;
}
```

---

## 🎨 최신 프롬프트 엔지니어링 (2025)

### 핵심 원칙
1. **명시성**: 구체적이고 명확한 지시사항
2. **간결성 강제**: 토큰 비용 절감을 위한 간결한 출력 요구
3. **양방향 지시**: 긴 컨텍스트 시 지시사항을 처음과 끝에 배치
4. **체인-오브-생각**: 복잡한 종교 용어 수정 시 단계별 사고

### 최적화된 시스템 프롬프트 구조

```
[역할 정의] (50 토큰)
  → "You are an expert {source_lang} to {target_lang} interpreter"

[환경 설정] (30 토큰)
  → "Context: {environment} (e.g., LDS church sermon)"

[핵심 지시사항] (100 토큰)
  → 번역 규칙, STT 오류 수정, 간결성 요구

[종교 용어 사전] (200 토큰)
  → 핵심 용어만 포함 (20-30개), 나머지는 요약에 포함

[출력 형식] (20 토큰)
  → "Output ONLY the translation, no explanations"
```

**총 토큰**: ~400 토큰 (기존 대비 50% 절감)

### 개선된 프롬프트 예시

```typescript
const OPTIMIZED_PROMPT = `You are an expert Korean-to-English interpreter for LDS church sermons.

TASK: Translate the current segment, fixing STT errors and maintaining context.

CONTEXT:
Summary: {summary}
Recent: {recentContext}

CURRENT: {currentText}

RULES:
1. Fix obvious STT errors (use context)
2. Use proper LDS terms (see below)
3. Translate concisely, preserve tone
4. Output ONLY translation

KEY TERMS: 몰몬경=Book of Mormon, 구주=Savior, 속죄=Atonement, 간증=testimony

OUTPUT: [translation only]`;
```

### 참고 자료 (2025 최신 기법)
- [GPT-4.1 Prompting Guide](https://cookbook.openai.com/examples/gpt4-1_prompting_guide)
- [Multi-Language Translation with Realtime API](https://cookbook.openai.com/examples/voice_solutions/one_way_translation_using_realtime_api)
- [Prompt Engineering Best Practices 2025](https://garrettlanders.com/prompt-engineering-guide-2025/)
- [OpenAI Realtime API Guide](https://platform.openai.com/docs/guides/realtime)

---

## 💰 비용 최적화 전략

### GPT-4o-mini 사용 (추천)
- **입력**: $0.150 / 1M 토큰
- **출력**: $0.600 / 1M 토큰
- **예상 비용**: 1시간 설교 (~10,000 단어)
  - STT 결과: ~200회 번역 × 1,000 토큰 = 200K 토큰
  - 비용: ~$0.15 (입출력 합계)

### 토큰 절약 기법
1. **요약 활용**: 오래된 컨텍스트를 요약으로 압축 (10:1 비율)
2. **간결성 강제**: 시스템 프롬프트에 "translate concisely" 명시
3. **배치 처리**: API 호출 횟수 감소
4. **캐싱**: 동일한 시스템 프롬프트 재사용 (OpenAI prompt caching)

---

## ✅ 최종 확정 사항

### 1. 번역 타이밍 전략
- ✅ **Option B**: 2-3초마다 배치 번역 (실시간성과 비용의 균형)

### 2. 컨텍스트 윈도우 크기
- ✅ **10개 문장** (약 1000 토큰, 충분한 문맥 + 합리적인 비용)

### 3. 요약 생성 주기
- ✅ **30개마다** (약 5분마다 업데이트, 균형잡힌 접근)

### 4. 번역 대상 언어
- ✅ **다국어 지원**: 사용자가 선택 가능 (영어, 일본어, 중국어 등)
- ✅ **기본값**: 영어

### 5. 환경 설정 (프리셋 시스템)
- ✅ **프리셋 시스템**: 교회/의료/법률/비즈니스/일반/커스텀
- ✅ **MVP**: LDS 교회에서 테스트하지만 범용적으로 설계
- ✅ **사용자 입력**: 환경 설명 및 커스텀 용어집 가능

### 6. OpenAI 모델 선택
- ✅ **gpt-5-nano** (현재 사용 중, 더 싸고 빠름)
- 참고: gpt-4o-mini ($0.15/1M), gpt-4o ($2.50/1M) 대비 우수

### 7. 스트리밍 사용 여부
- ✅ **Yes**: 점진적 번역 표시로 체감 지연시간 최소화

---

## 📅 구현 단계

### Phase 1: 프리셋 시스템 및 데이터베이스 (1일)
**목표**: 프리셋 기반 범용 번역 시스템의 기반 구축

1. **프리셋 정의 파일 생성**
   - `backend/src/modules/translation/presets.ts`
   - 교회/의료/법률/비즈니스/일반 프리셋 정의
   - 각 프리셋의 환경 설명 + 용어집 + 톤 설정

2. **데이터베이스 마이그레이션**
   - RoomSettings 테이블 확장 (environment_preset, target_languages 등)
   - TranslationText 테이블 생성
   - Sequelize 모델 업데이트

3. **TranslationText 모델 생성**
   - `backend/src/models/TranslationText.ts`
   - Room 및 SttText와의 관계 설정

4. **TranslationService 개선**
   - 프리셋 기반 동적 프롬프트 생성 함수
   - 스트리밍 지원 준비 (구조만)

**완료 조건**: 프리셋 정의 완료, DB 마이그레이션 성공

---

### Phase 2: TranslationManager 구현 (1-2일)
**목표**: 실시간 문맥 유지 번역 핵심 로직 구현

1. **TranslationManager 클래스 생성**
   - `backend/src/modules/translation/translation-manager.ts`
   - 컨텍스트 버퍼 관리 (최근 10개)
   - 2.5초 배치 타이머 로직
   - 30개마다 요약 생성

2. **TranslationService 통합**
   - `translateWithContext()` 호출
   - 프리셋 기반 프롬프트 동적 생성
   - 다국어 번역 지원

3. **번역 결과 저장**
   - TranscriptService 확장
   - TranslationText 테이블에 저장
   - 요약도 함께 저장

**완료 조건**: TranslationManager 단위 테스트 통과

---

### Phase 3: SocketHandler 통합 (1일)
**목표**: STT → 번역 파이프라인 완성

1. **SocketHandler 수정**
   - `backend/src/modules/socket/socket-handler.ts`
   - TranslationManager 인스턴스 생성 (룸별)
   - STT final transcript 수신 시 TranslationManager.addTranscript() 호출
   - 번역 콜백 처리 → Socket broadcast

2. **Socket 이벤트 추가**
   - `translation-text`: 번역 결과 전송
   - `translation-partial`: 스트리밍 중간 결과 (Phase 4)
   - `translation-error`: 번역 실패 시

3. **Room 생성/설정 수정**
   - 프리셋 선택 처리
   - 번역 언어 선택 처리
   - TranslationManager 설정 전달

**완료 조건**: STT → 번역 → Socket 전송 통합 테스트 성공

---

### Phase 4: 스트리밍 및 최적화 (1-2일)
**목표**: 체감 지연시간 최소화 및 성능 최적화

1. **스트리밍 번역 구현**
   - OpenAI Streaming API 통합
   - `translateWithStreaming()` 완성
   - 점진적 번역 결과 전송 (isPartial: true)
   - 프론트엔드 실시간 업데이트

2. **프롬프트 최적화**
   - 토큰 사용량 측정 및 최적화
   - 간결성 강제 프롬프트 개선
   - 용어집 크기 최적화 (핵심 20-30개만)

3. **성능 모니터링**
   - 지연시간 로깅 (STT → 번역 완료)
   - 토큰 사용량 트래킹
   - 비용 추정 대시보드

4. **에러 처리 개선**
   - API 실패 시 재시도 로직
   - Rate limiting 대응
   - Fallback: 번역 실패 시 원본 텍스트 표시

**완료 조건**: 스트리밍 작동, 지연시간 2-3초 이내

---

### Phase 5: 프론트엔드 통합 (1-2일)
**목표**: 사용자 경험 완성

1. **Room 설정 UI**
   - 환경 프리셋 선택 드롭다운
   - 커스텀 환경 설명 입력
   - 번역 언어 멀티셀렉트
   - 스트리밍 On/Off 토글

2. **번역 텍스트 표시**
   - STT 텍스트와 번역 텍스트 나란히 표시
   - 스트리밍 중간 결과 점진적 업데이트
   - 언어별 탭 또는 패널

3. **번역 히스토리**
   - 이전 번역 조회
   - Export 기능에 번역 포함 (PDF, TXT)

**완료 조건**: 전체 UX 플로우 테스트 완료

---

### Phase 6: 테스트 및 품질 개선 (1일)
**목표**: 실제 사용 준비

1. **통합 테스트**
   - 실제 교회 설교 샘플 오디오로 테스트
   - 종교 용어 정확도 검증
   - 다국어 번역 품질 확인

2. **성능 테스트**
   - 1시간 설교 시뮬레이션
   - 메모리 사용량 체크
   - 동시 다중 룸 테스트

3. **품질 개선**
   - 번역 오류 패턴 분석
   - 프롬프트 미세 조정
   - 용어집 보완

**완료 조건**: MVP 테스트 준비 완료

---

### 총 예상 기간: 6-8일

---

## 🧪 테스트 계획

1. **단위 테스트**
   - TranslationManager 각 함수
   - 컨텍스트 버퍼 관리
   - 요약 생성

2. **통합 테스트**
   - STT → 번역 파이프라인
   - 소켓 이벤트 처리
   - 데이터베이스 저장/조회

3. **성능 테스트**
   - 지연시간 측정 (STT → 번역 표시)
   - 토큰 사용량 측정
   - 비용 추정

4. **품질 테스트**
   - 종교 용어 정확도
   - 문맥 일관성
   - STT 오류 수정률

---

## 📊 예상 성능 지표

| 메트릭 | 현재 | 목표 |
|--------|------|------|
| STT → 번역 지연 | N/A (미구현) | 2-3초 |
| 번역 정확도 | N/A | 90%+ |
| 종교 용어 정확도 | N/A | 95%+ |
| 시간당 비용 (1시간 설교) | $0 | $0.10-0.20 |
| 토큰 효율성 | N/A | 1000 토큰/번역 |

---

## 🚀 다음 단계

1. **사용자 검토**: 위의 "검토 필요 사항" 결정
2. **프롬프트 엔지니어링**: 최종 시스템 프롬프트 작성
3. **코드 구현**: Phase 1부터 순차적 구현
4. **테스트 및 최적화**: 실제 설교 데이터로 테스트

---

## 💡 추가 아이디어

### 향후 개선 사항
- **실시간 용어집**: 사용자가 번역 중 용어를 추가/수정
- **화자 분리**: Deepgram diarization으로 여러 화자 구분
- **번역 품질 피드백**: 사용자가 번역 품질 평가 → 프롬프트 개선
- **오프라인 모드**: 로컬 LLM (llama.cpp) 지원
- **다중 번역 엔진**: OpenAI + Google Translate 병행 사용

### 기술적 고려사항
- **에러 처리**: API 실패 시 재시도 로직
- **Rate limiting**: OpenAI API 속도 제한 대응
- **Fallback**: 번역 실패 시 원본 텍스트 표시
- **모니터링**: Sentry 등으로 에러 추적

---

---

## 📝 최종 요약

### 핵심 결정사항

1. **번역 전략**: GPT (출발어→영어) + Google Translate (영어→다국어)
   - 비용 73% 절감
   - 영어가 피벗 언어
   - Google Translate Service 이미 구현되어 있음

2. **출발 언어**: 사용자 선택 가능 (기본: 한국어)
   - Deepgram STT 언어 설정과 연동
   - 영어 출발 시 Google Translate만 사용

3. **프리셋 시스템**: 교회/의료/법률/비즈니스/일반/커스텀
   - 도메인별 환경 설명 + 용어집
   - MVP는 교회, 범용적으로 설계

4. **실시간 문맥 유지**:
   - 슬라이딩 윈도우 10개 문장
   - 30개마다 요약 생성
   - 2.5초 배치 처리

5. **스트리밍**: 점진적 번역 표시 (체감 지연시간 최소화)

6. **모델**: gpt-5-nano (현재 사용 중, 더 싸고 빠름)

### 구현 순서

1. **Phase 1** (1일): 프리셋 시스템 + DB 마이그레이션
2. **Phase 2** (1-2일): TranslationManager 구현
3. **Phase 3** (1일): SocketHandler 통합
4. **Phase 4** (1-2일): 스트리밍 + 최적화
5. **Phase 5** (1-2일): 프론트엔드 통합
6. **Phase 6** (1일): 테스트 및 품질 개선

**총 예상 기간**: 6-8일

### 주요 파일 구조

```
backend/
├── src/
│   ├── models/
│   │   ├── RoomSettings.ts (확장)
│   │   └── TranslationText.ts (신규)
│   ├── modules/
│   │   ├── translation/
│   │   │   ├── presets.ts (신규)
│   │   │   ├── translation-manager.ts (신규)
│   │   │   ├── translation-service.ts (개선)
│   │   │   └── google-translate.service.ts (기존)
│   │   └── socket/
│   │       └── socket-handler.ts (수정)
│   └── infrastructure/
│       └── database/
│           └── migrations/
│               └── add-translation-features.sql (신규)
```

---

**작성일**: 2025-11-22
**작성자**: Claude Code
**상태**: 최종 확정 - 구현 준비 완료
