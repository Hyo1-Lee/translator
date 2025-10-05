# STT Provider 설정 가이드

이 프로젝트는 두 가지 STT(Speech-to-Text) 제공자를 지원합니다:
1. **RTZR (ReturnZero VITO)** - 실시간 스트리밍 STT
2. **OpenAI Whisper** - 고품질 배치 처리 STT

## 📊 제공자 비교

| 특성 | RTZR (VITO) | OpenAI Whisper |
|------|-------------|----------------|
| **실시간 스트리밍** | ✅ 지원 | ❌ 미지원 |
| **레이턴시** | ~500ms (실시간) | 2-5초 (배치 처리) |
| **정확도** | 높음 | 매우 높음 |
| **Prompt 지원** | ❌ | ✅ 지원 |
| **연결 방식** | WebSocket | HTTP API |
| **비용** | RTZR 요금제 | OpenAI 요금제 |

## 🎯 사용 시나리오

### RTZR 사용 권장
- 실시간 응답이 중요한 경우
- 낮은 레이턴시가 필요한 경우
- 스트리밍 방식으로 처리하고 싶은 경우

### OpenAI Whisper 사용 권장
- 특정 도메인 용어(예: 교회, 의료, 법률)의 높은 정확도가 필요한 경우
- 2-5초의 지연이 허용되는 경우
- Prompt를 통해 문맥을 제공하여 정확도를 높이고 싶은 경우

## ⚙️ 설정 방법

### 1. 환경 변수 설정

`.env` 파일에서 STT 제공자를 선택합니다:

```bash
# RTZR 사용
STT_PROVIDER=rtzr

# 또는 OpenAI Whisper 사용
STT_PROVIDER=openai
```

### 2. RTZR 설정

```bash
RTZR_CLIENT_ID=your_client_id
RTZR_CLIENT_SECRET=your_client_secret
RTZR_API_URL=https://openapi.vito.ai
```

### 3. OpenAI Whisper 설정

```bash
OPENAI_API_KEY=your_openai_api_key

# Prompt 설정 (선택사항, 정확도 향상)
OPENAI_STT_PROMPT=예수그리스도 휴기성도 교회의 말씀을 듣고 있습니다. 한국어 교회 예배, 설교, 찬양에 관련된 내용입니다.
```

## 🎤 OpenAI Whisper Prompt 활용

OpenAI Whisper는 prompt를 통해 문맥을 제공하여 정확도를 크게 향상시킬 수 있습니다.

### Prompt 예시

#### 교회/종교
```
예수그리스도 휴기성도 교회의 말씀을 듣고 있습니다. 한국어 교회 예배, 설교, 찬양에 관련된 내용입니다.
```

#### 의료
```
의료 진료 상담 내용입니다. 질병명, 약품명, 의료 전문 용어가 포함되어 있습니다.
```

#### 법률
```
법률 상담 내용입니다. 법률 용어, 조항, 판례 등이 포함되어 있습니다.
```

#### 기술/IT
```
소프트웨어 개발 회의입니다. 프로그래밍 언어, 기술 용어, 프레임워크 이름이 포함됩니다.
```

## 🔧 코드에서 제공자 전환

### 방법 1: 전역 설정 (.env)
```bash
STT_PROVIDER=openai
```

### 방법 2: 룸별 설정 (코드)
```typescript
// RTZR 사용
await sttManager.createClient(roomId, onTranscript, onTranslation, 'rtzr');

// OpenAI 사용
await sttManager.createClient(roomId, onTranscript, onTranslation, 'openai');
```

### 방법 3: 런타임에서 Prompt 업데이트
```typescript
// OpenAI 클라이언트의 prompt를 동적으로 변경
sttManager.updateOpenAIPrompt(
  roomId,
  '새로운 문맥: 의료 전문 용어가 포함된 상담입니다.'
);
```

## 📈 성능 고려사항

### OpenAI Whisper 레이턴시
- **오디오 청크 크기**: 기본 8초
- **처리 시간**: 2-5초
- **총 지연**: 약 10-13초 (청크 수집 8초 + 처리 2-5초)

청크 크기를 조정하려면:
```typescript
const client = new OpenAIClient(roomId, config);
client.setChunkDuration(5000); // 5초로 변경
```

### RTZR 레이턴시
- **실시간 스트리밍**: ~500ms
- **최종 결과**: 1-2초

## 🧪 테스트 방법

1. RTZR 테스트:
```bash
STT_PROVIDER=rtzr npm run dev
```

2. OpenAI Whisper 테스트:
```bash
STT_PROVIDER=openai npm run dev
```

3. 로그에서 확인:
```
[STT] rtzr-vito client created for room abc123
# 또는
[STT] openai-whisper client created for room abc123
[STT][OpenAI][abc123] ⚠️  Note: Expected latency is 2-5 seconds per chunk
```

## 🔍 현재 제공자 확인

```typescript
const provider = sttManager.getProvider(roomId);
console.log(`Current provider: ${provider}`);
// Output: "rtzr-vito" 또는 "openai-whisper"
```

## 💡 권장사항

1. **프로덕션 환경**:
   - 레이턴시가 중요하다면 RTZR 사용
   - 정확도가 중요하다면 OpenAI Whisper 사용

2. **Prompt 최적화**:
   - 가능한 구체적인 문맥 제공
   - 자주 등장하는 고유명사나 전문 용어 포함
   - 50-200자 정도의 적절한 길이 유지

3. **비용 최적화**:
   - RTZR: 분당 요금제 확인
   - OpenAI: 분당 $0.006 (Whisper API)

4. **하이브리드 접근**:
   - 중요한 회의/행사: OpenAI Whisper
   - 일반 대화: RTZR
