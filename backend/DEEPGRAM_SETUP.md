# Deepgram STT 설치 및 설정 가이드

## 🎯 왜 Deepgram인가?

| 항목 | Deepgram Nova-3 | 기존 (gpt-4o-realtime) | RTZR |
|------|----------------|----------------------|------|
| **한국어 정확도** | **90%+** | 65-83% | 불만족 |
| **레이턴시** | **<300ms** | ~500ms | 불만족 |
| **비용** | **$0.0077/분** | $0.096/분 | 미확인 |
| **실시간 스트리밍** | ✅ | ✅ | ✅ |
| **한국어 특화** | ✅ Enhanced 모델 | ❌ | ✅ |
| **안정성** | 엔터프라이즈급 | 커뮤니티 이슈 다수 | 불안정 |

## 📦 1단계: Deepgram SDK 설치

```bash
cd backend
npm install @deepgram/sdk
```

✅ **이미 완료됨**: `package.json`에 `@deepgram/sdk`가 추가되어 있습니다.

## 🔑 2단계: Deepgram API 키 발급

### 1) Deepgram 계정 생성
- https://deepgram.com/ 방문
- "Sign Up" 클릭
- 이메일 인증 완료

### 2) API 키 생성
1. Dashboard → API Keys 메뉴
2. "Create a New API Key" 클릭
3. Name: "Translator Service" (원하는 이름)
4. Scopes: "Member" 선택 (기본값)
5. API Key 복사 (⚠️ 한 번만 표시됨!)

### 3) 무료 크레딧
- 신규 가입 시 **$200 무료 크레딧** 제공
- 약 **26,000분 (433시간)** 무료 사용 가능
- 신용카드 등록 불필요

## ⚙️ 3단계: 환경 변수 설정

`backend/.env` 파일을 열어 다음 값을 설정:

```bash
# STT Provider 변경
STT_PROVIDER=deepgram

# Deepgram API 키 (발급받은 키로 교체)
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# Deepgram 모델 선택 (nova-3 또는 enhanced)
DEEPGRAM_MODEL=nova-3

# 기타 설정 (기본값 사용 권장)
DEEPGRAM_LANGUAGE=ko
DEEPGRAM_SMART_FORMAT=true
DEEPGRAM_PUNCTUATE=true
DEEPGRAM_DIARIZE=false
```

### 모델 선택 가이드

#### Nova-3 (추천) ⭐
```bash
DEEPGRAM_MODEL=nova-3
```
- **장점**: 최신 모델, 최고 성능, 54% 낮은 WER
- **단점**: 약간 비쌈 ($0.0077/분)
- **사용 케이스**: 최고 품질이 필요한 경우

#### Enhanced Korean
```bash
DEEPGRAM_MODEL=enhanced
```
- **장점**: 한국어 전용 최적화, 90%+ 정확도
- **단점**: Nova-3보다 약간 낮은 성능
- **사용 케이스**: 한국어 특성(음절, 활용) 중요한 경우

## 🚀 4단계: 서버 실행

```bash
cd backend
npm install  # 의존성 설치 (처음만)
npm run dev  # 개발 모드 실행
```

### 실행 로그 확인
정상 작동 시 다음과 같은 로그가 표시됩니다:

```
[STT][Deepgram][room-abc123] 🚀 Initializing with model: nova-3
[STT][Deepgram][room-abc123] 🔌 Connecting...
[STT][Deepgram][room-abc123] 🎯 Nova-3 with 22 keyterms
[STT][Deepgram][room-abc123] 🟢 WebSocket opened
[STT][Deepgram][room-abc123] ✅ Connected successfully
```

## 🎯 5단계: 키워드 커스터마이징 (선택사항)

교회 용어 외 다른 도메인을 사용하는 경우, 키워드를 수정할 수 있습니다.

### 1) 키워드 파일 수정
`backend/src/modules/stt/keywords-config.ts` 파일 열기

### 2) 기존 템플릿 수정 또는 새 템플릿 추가

```typescript
// 예: 의료 용어 추가
export const MEDICAL_KEYWORDS: KeywordConfig[] = [
  { term: '진단', intensifier: 4 },
  { term: '치료', intensifier: 4 },
  { term: '증상', intensifier: 4 },
  // ... 추가 용어
];
```

### 3) 템플릿 적용
`.env` 파일에서 템플릿 변경:

```bash
STT_PROMPT_TEMPLATE=medical  # church, medical, legal, business, tech, education, general
```

## 🔄 6단계: 모델 전환 (필요시)

### Deepgram → OpenAI로 전환
```bash
# .env 파일 수정
STT_PROVIDER=openai
```

### Deepgram → RTZR로 전환
```bash
# .env 파일 수정
STT_PROVIDER=rtzr
```

⚠️ 서버 재시작 필요 (`Ctrl+C` 후 `npm run dev`)

## 📊 7단계: 성능 모니터링

### 로그 확인
```
[STT][Deepgram][room-abc123] 📝 Final: "예수그리스도를 믿습니다" (confidence: 95.2%)
[STT][Deepgram][room-abc123] 📊 Final metrics: {...}
```

### 주요 지표
- **Confidence**: 90% 이상이면 우수
- **Latency**: <300ms 목표
- **Errors**: 0개 유지

## 🛠️ 트러블슈팅

### 문제 1: "DEEPGRAM_API_KEY is not set"
```bash
# .env 파일 확인
# DEEPGRAM_API_KEY가 설정되어 있는지 확인
# 앞뒤 공백 제거
```

### 문제 2: "Connection failed" 또는 "401 Unauthorized"
```bash
# API 키가 올바른지 확인
# Deepgram Dashboard에서 키 상태 확인
# 크레딧 잔액 확인 ($200 무료 크레딧)
```

### 문제 3: "WebSocket not ready"
```bash
# 네트워크 연결 확인
# 방화벽 설정 확인 (포트 443)
# 재연결 로직이 자동으로 작동함 (최대 5회 시도)
```

### 문제 4: 낮은 정확도
```bash
# 1. 오디오 품질 확인 (24kHz, 16-bit PCM)
# 2. 키워드 추가 (keywords-config.ts)
# 3. 모델 변경 (nova-3 ↔ enhanced)
```

## 💰 비용 계산

### Nova-3 모델
- **가격**: $0.0077/분
- **1시간 예배**: $0.462 (46센트)
- **월 10회 예배**: $4.62
- **연간**: ~$55

### 무료 크레딧 사용 시
- **$200 크레딧**: 약 26,000분 (433시간)
- **1시간 예배 기준**: 약 433회 무료

## 🎓 추가 리소스

- **Deepgram 공식 문서**: https://developers.deepgram.com/
- **Nova-3 소개**: https://deepgram.com/learn/introducing-nova-3-speech-to-text-api
- **한국어 지원**: https://deepgram.com/learn/enhanced-korean
- **요금제**: https://deepgram.com/pricing

## ✅ 체크리스트

- [ ] Deepgram SDK 설치 (`npm install @deepgram/sdk`)
- [ ] Deepgram API 키 발급
- [ ] `.env` 파일에 API 키 설정
- [ ] `STT_PROVIDER=deepgram` 설정
- [ ] 서버 실행 (`npm run dev`)
- [ ] 정상 작동 로그 확인
- [ ] 테스트 오디오로 정확도 확인
- [ ] (선택) 키워드 커스터마이징

## 🎉 완료!

이제 한국어 실시간 STT를 최고 성능으로 사용할 수 있습니다!

- **<300ms 레이턴시**로 실시간 자막
- **90%+ 정확도**로 교회 용어 정확하게 인식
- **$0.0077/분**의 합리적인 비용
- **엔터프라이즈급 안정성**

문의사항이나 문제가 있으면 이슈를 남겨주세요!
