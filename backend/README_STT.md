# Production-Grade STT Implementation

This project implements a sophisticated, production-ready Speech-to-Text system supporting multiple providers with advanced features.

## 🎯 Architecture Overview

### Provider Pattern
- **Abstraction Layer**: `STTProvider` interface for provider-agnostic implementation
- **Multiple Providers**: RTZR (VITO) and OpenAI Realtime API
- **Hot Swapping**: Switch providers per room or globally without code changes
- **Type Safety**: Full TypeScript support with strict typing

### Supported Providers

| Provider | Type | Latency | Use Case |
|----------|------|---------|----------|
| **RTZR (VITO)** | WebSocket Streaming | ~500ms | Korean-optimized, low latency |
| **OpenAI Realtime** | WebSocket Streaming | ~200-400ms | Multi-language, high accuracy, prompt support |

## 🚀 OpenAI Realtime API Features

### Real-Time Streaming
- **WebSocket Connection**: Persistent bidirectional communication
- **Low Latency**: ~200-400ms end-to-end latency
- **VAD (Voice Activity Detection)**: Server-side automatic speech detection
- **Audio Streaming**: PCM16 @ 24kHz mono audio

### Advanced Prompt Engineering
Prompts are **engineered in code**, not in environment variables, for:
- Version control and code review
- Type safety and IDE support
- Easy customization and A/B testing
- Template inheritance and composition

#### Built-in Templates
Located in `src/modules/stt/prompts/prompt-templates.ts`:

1. **Church Service** (`church`)
   - Optimized for religious terminology
   - Korean church services, sermons, prayers
   - Proper nouns: 예수그리스도, 휴기성도, 교회

2. **Medical Consultation** (`medical`)
   - Clinical terminology and drug names
   - Doctor-patient conversations
   - Medical procedures and diagnoses

3. **Legal Consultation** (`legal`)
   - Legal terminology and statute references
   - Formal language and legal jargon
   - Contract discussions

4. **Business Meeting** (`business`)
   - Corporate terminology
   - Financial metrics and KPIs
   - Mix of Korean and English business terms

5. **Technical Discussion** (`tech`)
   - Programming languages and frameworks
   - Software architecture discussions
   - English technical terms in Korean context

6. **Educational Lecture** (`education`)
   - Academic terminology
   - Subject-specific vocabulary
   - Instructor-student interactions

7. **General Conversation** (`general`)
   - Default for general-purpose transcription

### Production-Grade Features

#### 1. Connection Management
```typescript
- Automatic reconnection with exponential backoff
- Maximum 10 reconnection attempts
- Backoff: 1s → 2s → 4s → 8s → ... → 30s (max)
- Graceful degradation on failures
```

#### 2. Session State Tracking
```typescript
enum SessionState {
  DISCONNECTED,  // Not connected
  CONNECTING,    // Connection in progress
  CONNECTED,     // WebSocket open
  READY,         // Session configured, ready for audio
  ERROR          // Error state
}
```

#### 3. Audio Buffer Management
```typescript
- Queue size limit: 100 chunks
- Backpressure handling
- Automatic queue processing when connected
- Buffer overflow protection
```

#### 4. Heartbeat & Health Monitoring
```typescript
- Heartbeat every 10 seconds
- Session timeout: 60 seconds
- Automatic reconnection on timeout
- Activity tracking
```

#### 5. Performance Metrics
```typescript
{
  messagesReceived: number;
  transcriptionsReceived: number;
  audioBytesSent: number;
  errors: number;
  reconnections: number;
  averageLatency: number;
  lastLatencies: number[];  // Last 10 latencies
}
```

## 📝 Usage Guide

### Basic Setup

#### 1. Environment Configuration
```bash
# .env
STT_PROVIDER=openai
STT_PROMPT_TEMPLATE=church

OPENAI_API_KEY=sk-...
OPENAI_REALTIME_MODEL=gpt-4o-realtime-preview-2024-12-17
```

#### 2. Create STT Client
```typescript
import { STTManager } from './modules/stt/stt-manager';

// Create with default provider
await sttManager.createClient(
  roomId,
  onTranscript,
  onTranslation
);

// Create with specific provider
await sttManager.createClient(
  roomId,
  onTranscript,
  onTranslation,
  'openai'  // Override default
);
```

#### 3. Send Audio
```typescript
// Audio must be PCM16, 24kHz, mono for OpenAI
// Audio must be LINEAR16, 16kHz, mono for RTZR
sttManager.sendAudio(roomId, audioBuffer);
```

#### 4. Handle Transcripts
```typescript
function onTranscript(data: TranscriptData) {
  console.log(`[${data.roomId}] ${data.text}`);
  console.log(`Confidence: ${data.confidence}`);
}
```

### Advanced Features

#### Dynamic Prompt Switching
```typescript
// Change prompt template at runtime
sttManager.updateOpenAIPromptTemplate(roomId, 'medical');
```

#### Custom Prompt Template
```typescript
import { createCustomPrompt } from './prompts/prompt-templates';

const customPrompt = createCustomPrompt(
  'Custom Domain',
  'Specialized terminology for X',
  'Context about the conversation...',
  ['term1', 'term2', 'term3']
);
```

#### Monitor Performance
```typescript
const metrics = sttManager.getClientMetrics(roomId);
console.log(`Average latency: ${metrics.averageLatency}ms`);
console.log(`Transcriptions: ${metrics.transcriptionsReceived}`);
console.log(`Errors: ${metrics.errors}`);
console.log(`Reconnections: ${metrics.reconnections}`);
```

#### Provider Detection
```typescript
const provider = sttManager.getProvider(roomId);
console.log(`Using provider: ${provider}`);
// Output: "openai-realtime" or "rtzr-vito"
```

## 🔧 Configuration Reference

### OpenAI Realtime API

#### Model
```bash
OPENAI_REALTIME_MODEL=gpt-4o-realtime-preview-2024-12-17
```

#### VAD (Voice Activity Detection)
```bash
# Threshold (0.0-1.0): Speech detection sensitivity
# Lower = more sensitive (catches quiet speech, may have noise)
# Higher = less sensitive (only clear speech)
OPENAI_VAD_THRESHOLD=0.5

# Silence duration (ms): How long before speech is considered ended
OPENAI_VAD_SILENCE=500

# Prefix padding (ms): Audio to include before detected speech
OPENAI_PREFIX_PADDING=300
```

#### Temperature
```bash
# 0.0-1.0: Transcription variability
# Lower = more deterministic, Higher = more varied
OPENAI_TEMPERATURE=0.8
```

#### Turn Detection
```bash
# server_vad: Automatic speech detection
# disabled: Manual control (use input_audio_buffer.commit)
OPENAI_TURN_DETECTION=server_vad
```

## 📊 Performance Comparison

### Latency Breakdown

**RTZR (VITO)**
```
Audio chunk → WebSocket → Processing → Transcript
├─ Network: ~50-100ms
├─ Processing: ~300-400ms
└─ Total: ~500ms
```

**OpenAI Realtime**
```
Audio chunk → WebSocket → VAD → Processing → Transcript
├─ Network: ~50-100ms
├─ VAD: ~50-100ms
├─ Processing: ~100-200ms
└─ Total: ~200-400ms
```

### Cost Comparison

**RTZR**: Per-minute pricing (check VITO pricing page)

**OpenAI Realtime API** (2025 pricing):
- Audio input: $32 per 1M tokens (~$0.08/min)
- Audio output: $64 per 1M tokens (~$0.16/min)
- Cached audio input: $0.40 per 1M tokens

### Accuracy

| Provider | General Korean | Domain Terms | Multi-speaker |
|----------|---------------|--------------|---------------|
| RTZR | ★★★★☆ | ★★★☆☆ | ★★★★☆ |
| OpenAI + Prompt | ★★★★★ | ★★★★★ | ★★★★☆ |

## 🛠️ Error Handling

### Connection Errors
```typescript
client.on('error', (error) => {
  // Automatic reconnection triggered
  // Logs error details
  // Emits error event to application
});
```

### Reconnection Strategy
1. Connection fails or drops
2. Wait 1 second, attempt reconnection
3. If fails, wait 2 seconds (exponential backoff)
4. Continue up to 10 attempts
5. Max delay capped at 30 seconds
6. After max attempts, stop and emit error

### Audio Queue Overflow
- Max queue size: 100 chunks
- Oldest chunks dropped first (FIFO)
- Warning logged when overflow occurs
- Graceful recovery when connection restored

## 🎓 Best Practices

### 1. Prompt Engineering
```typescript
// ✅ Good: Specific, contextual prompts in code
const CHURCH_PROMPT = {
  instructions: `Transcribing Korean church service...
    Contains: sermons, prayers, hymns
    Terminology: 예수그리스도, 휴기성도, 교회`
};

// ❌ Bad: Generic prompts in environment variables
PROMPT="transcribe korean"
```

### 2. Error Recovery
```typescript
// ✅ Good: Let automatic reconnection handle it
client.on('error', (error) => {
  logger.error('STT error:', error);
  // Reconnection happens automatically
});

// ❌ Bad: Manual reconnection without backoff
client.on('error', () => {
  client.connect(); // Creates connection storm
});
```

### 3. Audio Format
```typescript
// ✅ Good: Correct format for provider
const audioConfig = {
  sampleRate: 24000,  // OpenAI requires 24kHz
  channels: 1,
  encoding: 'pcm16'
};

// ❌ Bad: Wrong format causes poor quality
const audioConfig = {
  sampleRate: 8000,   // Too low
  channels: 2,        // Stereo not needed
  encoding: 'mp3'     // Requires transcoding
};
```

### 4. Monitoring
```typescript
// ✅ Good: Track metrics for debugging
setInterval(() => {
  const metrics = sttManager.getClientMetrics(roomId);
  if (metrics.averageLatency > 1000) {
    logger.warn('High latency detected');
  }
}, 60000);
```

## 🔍 Troubleshooting

### High Latency
1. Check VAD settings (may be waiting too long for silence)
2. Verify network connection quality
3. Review audio chunk size (too large = higher latency)
4. Monitor metrics for bottlenecks

### Poor Transcription Quality
1. **Use appropriate prompt template** for domain
2. Verify audio format (24kHz PCM16 for OpenAI)
3. Check audio input quality (noise, volume)
4. Review VAD threshold (may be cutting off speech)

### Frequent Disconnections
1. Check API key validity
2. Verify network stability
3. Review session timeout settings
4. Check rate limits (OpenAI has session limits)

### Empty Transcriptions
1. Verify audio format is correct
2. Check VAD sensitivity settings
3. Ensure audio volume is adequate
4. Review input_audio_transcription config

## 📚 API Reference

### STTManager Methods

```typescript
// Create client
createClient(
  roomId: string,
  onTranscript: (data: TranscriptData) => void,
  onTranslation?: (data: any) => void,
  providerOverride?: 'rtzr' | 'openai'
): Promise<void>

// Send audio
sendAudio(roomId: string, audioData: Buffer): void

// Remove client
removeClient(roomId: string): void

// Get provider name
getProvider(roomId: string): string | null

// Update prompt (OpenAI only)
updateOpenAIPromptTemplate(roomId: string, templateName: string): void

// Get metrics (OpenAI only)
getClientMetrics(roomId: string): MetricsObject | null

// Check active clients
hasActiveClient(roomId: string): boolean
getActiveClientCount(): number
```

### Events

```typescript
client.on('connected', () => {
  // Session ready for audio
});

client.on('transcript', (result: TranscriptResult) => {
  // New transcription available
  // result.text, result.confidence, result.final
});

client.on('speech_started', () => {
  // VAD detected speech start (OpenAI only)
});

client.on('speech_stopped', () => {
  // VAD detected speech end (OpenAI only)
});

client.on('error', (error: Error) => {
  // Error occurred
});

client.on('disconnected', () => {
  // Connection closed
});
```

## 🚧 Migration Guide

### From Old OpenAI Client (Whisper API)

```diff
- import { OpenAIClient } from './openai-client';
+ import { OpenAIRealtimeClient } from './openai-realtime-client';

- const client = new OpenAIClient(roomId, {
-   apiKey: 'sk-...',
-   model: 'whisper-1',
-   prompt: 'Church service...'
- });
+ const client = new OpenAIRealtimeClient(roomId, {
+   apiKey: 'sk-...',
+   model: 'gpt-4o-realtime-preview-2024-12-17'
+ }, 'church');  // Template name instead of inline prompt

- // Batch processing with 8-second chunks
+ // Real-time streaming (no chunking needed)

- client.setChunkDuration(5000);
+ // No longer needed - streams continuously

- // Latency: 2-5 seconds per chunk
+ // Latency: 200-400ms continuous
```

## 📖 Additional Resources

- [OpenAI Realtime API Docs](https://platform.openai.com/docs/guides/realtime)
- [RTZR VITO API Docs](https://developers.rtzr.ai/)
- [Prompt Engineering Guide](./prompts/prompt-templates.ts)
- [Configuration Reference](./.env.example)

---

**Last Updated**: 2025-10-05
**OpenAI Model**: gpt-4o-realtime-preview-2024-12-17
**Architecture**: Production-grade, enterprise-ready
