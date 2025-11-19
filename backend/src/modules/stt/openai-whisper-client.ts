import { STTProvider } from "./stt-provider.interface";
import OpenAI from "openai";
import { Readable } from "stream";

interface OpenAIWhisperConfig {
  apiKey: string;
  model?: string;
  language?: string;
  prompt?: string;
  temperature?: number;
  responseFormat?: "json" | "text" | "srt" | "verbose_json" | "vtt";
}

export class OpenAIWhisperClient extends STTProvider {
  private config: OpenAIWhisperConfig;
  private openai: OpenAI;
  private audioBuffer: Buffer[] = [];
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private lastProcessTime: number = 0;
  private minChunkDuration: number = 2000; // 최소 2초 분량의 오디오 모아서 전송
  private sampleRate: number = 24000; // 24kHz
  private bytesPerSample: number = 2; // 16-bit PCM
  private lastTranscript: string = "";
  private transcriptBuffer: string[] = [];

  constructor(roomId: string, config: OpenAIWhisperConfig) {
    super(roomId);
    this.config = {
      model: "whisper-1",
      language: "ko",
      responseFormat: "verbose_json",
      temperature: 0,
      ...config,
    };
    this.openai = new OpenAI({ apiKey: this.config.apiKey });
  }

  async connect(): Promise<void> {
    console.log(`[STT][${this.roomId}] Connecting to OpenAI Whisper API...`);
    this.isConnected = true;
    this.lastProcessTime = Date.now();

    // 주기적으로 버퍼 처리 (1초마다 체크)
    this.processingInterval = setInterval(() => {
      this.checkAndProcessBuffer();
    }, 1000);

    this.emit("connected");
    console.log(`[STT][${this.roomId}] Connected to OpenAI Whisper API`);
  }

  private async checkAndProcessBuffer(): Promise<void> {
    if (this.isProcessing || this.audioBuffer.length === 0) {
      return;
    }

    const now = Date.now();
    const timeSinceLastProcess = now - this.lastProcessTime;
    const bufferBytes = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    const bufferDuration = (bufferBytes / (this.sampleRate * this.bytesPerSample)) * 1000;

    // 최소 청크 시간 또는 5초 경과 시 처리
    if (bufferDuration >= this.minChunkDuration || timeSinceLastProcess >= 5000) {
      await this.processAudioBuffer();
    }
  }

  private async processAudioBuffer(): Promise<void> {
    if (this.audioBuffer.length === 0 || this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    const audioData = Buffer.concat(this.audioBuffer);
    this.audioBuffer = [];
    this.lastProcessTime = Date.now();

    try {
      console.log(`[STT][${this.roomId}] 📤 Processing ${audioData.length} bytes with Whisper API...`);

      // PCM 데이터를 WAV 형식으로 변환
      const wavBuffer = this.pcmToWav(audioData, this.sampleRate, this.bytesPerSample);

      // Blob으로 변환하여 File 객체 생성
      const audioFile = new File([wavBuffer], "audio.wav", { type: "audio/wav" });

      // Whisper API 호출
      const startTime = Date.now();
      const response = await this.openai.audio.transcriptions.create({
        file: audioFile,
        model: this.config.model!,
        language: this.config.language,
        prompt: this.config.prompt,
        temperature: this.config.temperature,
        response_format: this.config.responseFormat,
      });

      const latency = Date.now() - startTime;

      // 응답 처리
      let text = "";
      if (typeof response === "string") {
        text = response.trim();
      } else if ("text" in response) {
        text = response.text.trim();
      }

      if (text && text !== this.lastTranscript) {
        console.log(`[STT][${this.roomId}] ⚡ Whisper latency: ${latency}ms | Text: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}"`);

        this.lastTranscript = text;
        this.transcriptBuffer.push(text);

        this.emit("transcript", {
          text,
          confidence: 1.0,
          final: true,
        });
      }
    } catch (error: any) {
      console.error(`[STT][${this.roomId}] Whisper API error:`, error?.message || error);
      this.emit("error", error);
    } finally {
      this.isProcessing = false;
    }
  }

  private pcmToWav(pcmData: Buffer, sampleRate: number, bytesPerSample: number): Buffer {
    const numChannels = 1; // Mono
    const bitsPerSample = bytesPerSample * 8;
    const byteRate = sampleRate * numChannels * bytesPerSample;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = pcmData.length;
    const headerSize = 44;

    const buffer = Buffer.alloc(headerSize + dataSize);

    // WAV 헤더 작성
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // Audio format (1 = PCM)
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);

    // PCM 데이터 복사
    pcmData.copy(buffer, headerSize);

    return buffer;
  }

  sendAudio(audioData: Buffer): void {
    if (!this.isConnected) {
      console.warn(`[STT][${this.roomId}] ⚠️  Not connected, ignoring audio`);
      return;
    }

    this.audioBuffer.push(audioData);

    // 버퍼가 너무 커지면 처리
    const bufferBytes = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    const bufferDuration = (bufferBytes / (this.sampleRate * this.bytesPerSample)) * 1000;

    if (bufferDuration >= 10000) {
      // 10초 이상 모이면 즉시 처리
      this.processAudioBuffer();
    }
  }

  endStream(): void {
    // 남은 버퍼 처리
    if (this.audioBuffer.length > 0) {
      this.processAudioBuffer();
    }
  }

  disconnect(): void {
    console.log(`[STT][${this.roomId}] Disconnecting from OpenAI Whisper API...`);

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    // 남은 오디오 처리
    if (this.audioBuffer.length > 0) {
      this.processAudioBuffer();
    }

    this.isConnected = false;
    this.audioBuffer = [];
    this.emit("disconnected");
  }

  isActive(): boolean {
    return this.isConnected;
  }

  getProviderName(): string {
    return "openai-whisper";
  }
}
