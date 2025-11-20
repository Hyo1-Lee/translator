# 🔧 오디오 포맷 불일치 문제 해결

## 🚨 발견된 문제들

### 1. 클라이언트가 계속 제거/재생성됨
**원인**:
- `handleCreateRoom`에서 기존 클라이언트를 무조건 제거
- 프론트엔드가 `create-room`을 중복 호출 시 클라이언트 재시작

**해결**:
```typescript
// BEFORE: 무조건 제거
this.sttManager.removeClient(previousRoom.roomCode);

// AFTER: 같은 룸이 아닐 때만 제거
if (previousRoom && previousRoom.roomCode !== existingRoomCode) {
  this.sttManager.removeClient(previousRoom.roomCode);
}
```

### 2. Deepgram Metadata에 channels: 0
**원인**:
- 오디오가 전혀 전송되지 않음
- 연결 후 오디오 전송 전에 연결 닫힘

**해결**:
- 클라이언트 재사용으로 안정성 확보
- 로그 추가로 오디오 흐름 추적

### 3. 샘플링 레이트 불일치 (CRITICAL)
**원인**:
- 프론트엔드: 24000 Hz 요청했으나 브라우저는 48000 Hz 제공
- 백엔드: 24000 Hz로 설정
- Deepgram: 24000 Hz로 디코드하려 함
- **결과**: 오디오가 2배 빠르게 재생 → 인식 실패

**해결**:
- **백엔드**: 16000 Hz로 변경 (더 안정적)
- **프론트엔드**: 16000 Hz로 리샘플링 필요

---

## 🎯 수정 완료 항목

### 백엔드

1. **socket-handler.ts**:
   - ✅ 불필요한 클라이언트 제거 방지
   - ✅ 오디오 수신 로그 추가
   - ✅ 상세한 디버깅 로그

2. **deepgram-client.ts**:
   - ✅ 샘플 레이트: 24000 → 16000 Hz
   - ✅ 오디오 설정 로그 추가

---

## 🔴 프론트엔드 수정 필요

### 현재 프론트엔드 설정 (문제)
```typescript
audioContextRef.current = new AudioContext({
  sampleRate: 24000  // ❌ 브라우저가 무시하고 48000으로 설정
});

// 실제로는 48000 Hz 오디오를 받음
// 하지만 24000 Hz라고 생각하고 전송
// Deepgram은 24000 Hz로 디코드 시도
// → 2배 빠른 소리 → 인식 실패
```

### 해결 방법 1: 브라우저 기본값 사용 (권장)
```typescript
// 브라우저 기본 샘플 레이트 사용 (보통 48000 Hz)
const audioContext = new AudioContext();
const actualSampleRate = audioContext.sampleRate;

// 백엔드에 실제 샘플 레이트 전달
socket.emit('audio-config', { sampleRate: actualSampleRate });

// 백엔드는 이 값을 Deepgram에 전달
```

### 해결 방법 2: 16kHz로 다운샘플링
```typescript
const TARGET_SAMPLE_RATE = 16000;
const audioContext = new AudioContext();
const sourceSampleRate = audioContext.sampleRate;  // 보통 48000

// ScriptProcessor에서 다운샘플링
processorRef.current.onaudioprocess = (e) => {
  const inputData = e.inputBuffer.getChannelData(0);

  // 다운샘플링 (48000 → 16000 = 3:1 비율)
  const ratio = sourceSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.floor(inputData.length / ratio);
  const outputData = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = Math.floor(i * ratio);
    outputData[i] = inputData[srcIndex];
  }

  // Int16로 변환 후 전송
  const int16Data = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const s = Math.max(-1, Math.min(1, outputData[i]));
    int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const base64Audio = btoa(String.fromCharCode(...new Uint8Array(int16Data.buffer)));
  socket.emit("audio-stream", { roomId, audio: base64Audio });
};
```

### 해결 방법 3: AudioWorklet 사용 (최상의 품질)
```typescript
// AudioWorklet은 별도 스레드에서 실행되어 성능 우수
// resampler-processor.js
class ResamplerProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0][0];
    // 리샘플링 로직
    return true;
  }
}

registerProcessor('resampler-processor', ResamplerProcessor);
```

---

## 🚀 권장 수정 순서

### 1단계: 프론트엔드 간단 수정 (빠른 테스트)
```typescript
// speaker/page.tsx 수정
audioContextRef.current = new AudioContext();  // sampleRate 옵션 제거
const actualRate = audioContextRef.current.sampleRate;
console.log(`[Audio] Using browser's native sample rate: ${actualRate} Hz`);

// 백엔드도 48000 Hz로 변경
// deepgram-client.ts
sample_rate: 48000  // 또는 동적으로 설정
```

### 2단계: 동적 샘플 레이트 전달
```typescript
// 프론트엔드: create-room 시 샘플 레이트 전달
socket.emit("create-room", {
  ...data,
  audioConfig: {
    sampleRate: audioContext.sampleRate,
    encoding: 'linear16',
    channels: 1
  }
});

// 백엔드: 받은 샘플 레이트를 Deepgram에 전달
await this.sttManager.createClient(
  room.roomCode,
  callback,
  undefined,
  template,
  audioConfig  // 전달
);
```

### 3단계: 16kHz 다운샘플링 (최종 최적화)
- CPU 사용량 감소
- 대역폭 감소
- 레이턴시 감소
- 음성 인식 품질 유지

---

## 📊 예상 결과

### BEFORE (문제)
```
[Deepgram] Metadata: { "channels": 0, "duration": 0 }
[Deepgram] 🔴 Connection closed
→ 오디오 인식 실패
```

### AFTER (수정)
```
[Room] 🔍 Active STT clients: [C3WSW3]
[Audio][C3WSW3] ✅ Received chunk #1 (4096 bytes)
[Deepgram][C3WSW3] 🎙️  Audio config: linear16, 16000Hz, 1ch
[Deepgram][C3WSW3] 🎤 First audio chunk sent: 4096 bytes
[Deepgram][C3WSW3] 📝 Final: "안녕하세요" (conf: 95.2%)
→ 정상 인식!
```

---

## 🔍 디버깅 체크리스트

실행 후 로그 확인:
- [ ] `[Room] 🔍 Active STT clients: [...]` - 클라이언트 존재 확인
- [ ] `[Audio][ROOM] ✅ Received chunk #1` - 오디오 수신 확인
- [ ] `[Deepgram][ROOM] 🎙️  Audio config: ...` - 설정 확인
- [ ] `[Deepgram][ROOM] 🎤 First audio chunk sent` - Deepgram 전송 확인
- [ ] `[Deepgram][ROOM] 📝 Final: "..."` - Transcript 수신 확인
- [ ] Metadata의 `channels > 0` - 오디오 정상 수신

---

## 💡 핵심 교훈

1. **샘플 레이트 불일치는 조용한 실패를 유발**
   - 에러 없이 실행되지만 인식 안됨
   - 반드시 프론트-백엔드-Deepgram 일치 확인

2. **브라우저는 요청한 샘플 레이트를 무시할 수 있음**
   - `AudioContext({ sampleRate: 24000 })`은 힌트일 뿐
   - 실제 값은 `audioContext.sampleRate`로 확인

3. **클라이언트 재사용이 중요**
   - 불필요한 재생성은 연결 불안정 유발
   - KeepAlive가 있어도 재생성 중엔 오디오 유실

4. **로그는 생명줄**
   - 각 단계마다 로그 필수
   - 특히 첫 청크 전송/수신 로그
