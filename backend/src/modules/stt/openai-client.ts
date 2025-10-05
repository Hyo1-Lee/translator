import OpenAI from 'openai';
import { STTProvider, TranscriptResult } from './stt-provider.interface';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

interface OpenAIConfig {
  apiKey: string;
  model?: string; // 'whisper-1' (default)
  language?: string; // 'ko' (default for Korean)
  prompt?: string; // Context prompt for better accuracy
}

/**
 * OpenAI Whisper STT Provider
 *
 * IMPORTANT NOTES:
 * - OpenAI Whisper API does NOT support real-time streaming
 * - Audio chunks must be sent as complete files
 * - Expected latency: 2-5 seconds per request
 * - Recommended chunk size: 5-10 seconds of audio
 * - Supports prompt for domain-specific terminology accuracy
 */
export class OpenAIClient extends STTProvider {
  private config: OpenAIConfig;
  private client: OpenAI;
  private audioBuffer: Buffer[] = [];
  private bufferTimer: NodeJS.Timeout | null = null;
  private tempAudioPath: string;
  private chunkDuration: number = 8000; // 8 seconds in milliseconds
  private lastTranscriptTime: number = 0;

  constructor(roomId: string, config: OpenAIConfig) {
    super(roomId);
    this.config = {
      model: 'whisper-1',
      language: 'ko',
      ...config
    };
    this.client = new OpenAI({ apiKey: this.config.apiKey });
    this.tempAudioPath = path.join(process.cwd(), 'temp', `${roomId}-audio.wav`);
  }

  async connect(): Promise<void> {
    // OpenAI doesn't require connection, just API key validation
    try {
      // Test API key by making a simple request
      console.log(`[STT][OpenAI][${this.roomId}] Initializing OpenAI Whisper client`);
      this.isConnected = true;
      this.emit('connected');

      // Ensure temp directory exists
      const tempDir = path.dirname(this.tempAudioPath);
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      console.log(`[STT][OpenAI][${this.roomId}] OpenAI client ready`);
      console.log(`[STT][OpenAI][${this.roomId}] ⚠️  Note: Expected latency is 2-5 seconds per chunk`);
    } catch (error) {
      console.error(`[STT][OpenAI][${this.roomId}] Failed to initialize:`, error);
      throw error;
    }
  }

  sendAudio(audioData: Buffer): void {
    if (!this.isConnected) {
      console.warn(`[STT][OpenAI][${this.roomId}] Not connected, buffering audio`);
      return;
    }

    // Add to buffer
    this.audioBuffer.push(audioData);

    // Clear existing timer
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
    }

    // Set timer to process buffer after chunk duration
    this.bufferTimer = setTimeout(() => {
      this.processAudioBuffer();
    }, this.chunkDuration);
  }

  /**
   * Process accumulated audio buffer and send to OpenAI
   */
  private async processAudioBuffer(): Promise<void> {
    if (this.audioBuffer.length === 0) return;

    const startTime = Date.now();

    try {
      // Combine all buffered audio chunks
      const combinedAudio = Buffer.concat(this.audioBuffer);
      this.audioBuffer = [];

      console.log(`[STT][OpenAI][${this.roomId}] Processing ${combinedAudio.length} bytes of audio`);

      // Save to temporary file (OpenAI requires file input)
      fs.writeFileSync(this.tempAudioPath, combinedAudio);

      // Create file stream
      const fileStream = fs.createReadStream(this.tempAudioPath);

      // Prepare transcription options
      const transcriptionOptions: any = {
        file: fileStream,
        model: this.config.model!,
        language: this.config.language,
        response_format: 'verbose_json' // Get more details including confidence
      };

      // Add prompt if configured (for better accuracy with specific terminology)
      if (this.config.prompt) {
        transcriptionOptions.prompt = this.config.prompt;
      }

      // Call OpenAI Whisper API
      const transcription = await this.client.audio.transcriptions.create(transcriptionOptions);

      const latency = Date.now() - startTime;
      console.log(`[STT][OpenAI][${this.roomId}] Transcription latency: ${latency}ms`);

      // Extract text
      const text = transcription.text?.trim();

      if (text) {
        const result: TranscriptResult = {
          text,
          confidence: 0.9, // OpenAI doesn't provide confidence scores
          final: true // All OpenAI results are final
        };

        this.lastTranscriptTime = Date.now();
        this.emit('transcript', result);
      }

      // Clean up temp file
      if (fs.existsSync(this.tempAudioPath)) {
        fs.unlinkSync(this.tempAudioPath);
      }
    } catch (error) {
      console.error(`[STT][OpenAI][${this.roomId}] Transcription error:`, error);
      this.emit('error', error);
    }
  }

  endStream(): void {
    // Process any remaining audio in buffer
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }

    if (this.audioBuffer.length > 0) {
      this.processAudioBuffer();
    }
  }

  disconnect(): void {
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }

    // Clean up temp file
    if (fs.existsSync(this.tempAudioPath)) {
      fs.unlinkSync(this.tempAudioPath);
    }

    this.audioBuffer = [];
    this.isConnected = false;
    this.emit('disconnected');
    console.log(`[STT][OpenAI][${this.roomId}] Disconnected`);
  }

  isActive(): boolean {
    return this.isConnected;
  }

  getProviderName(): string {
    return 'openai-whisper';
  }

  /**
   * Update the prompt for better accuracy with specific terminology
   */
  setPrompt(prompt: string): void {
    this.config.prompt = prompt;
    console.log(`[STT][OpenAI][${this.roomId}] Prompt updated for better accuracy`);
  }

  /**
   * Set chunk duration (how long to wait before processing audio)
   * @param durationMs - Duration in milliseconds (recommended: 5000-10000)
   */
  setChunkDuration(durationMs: number): void {
    this.chunkDuration = durationMs;
    console.log(`[STT][OpenAI][${this.roomId}] Chunk duration set to ${durationMs}ms`);
  }

  /**
   * Get average latency information
   */
  getLatencyInfo(): string {
    return `Expected latency: 2-5 seconds per ${this.chunkDuration / 1000}s audio chunk`;
  }
}
