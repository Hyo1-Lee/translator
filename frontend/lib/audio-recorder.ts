/**
 * Audio Recorder for Speech-to-Text
 *
 * Handles microphone access, audio processing, and streaming
 */

import { processAudioChunk, AudioProcessConfig, DEFAULT_AUDIO_CONFIG, calculateRMS } from "./audio-utils";

export interface AudioRecorderConfig {
  audioProcessConfig?: AudioProcessConfig;
  onAudioData?: (base64Audio: string) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error) => void;
}

export class AudioRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private animationFrameId: number | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  private config: Required<AudioRecorderConfig>;
  private isRecording = false;
  private audioChunksSent = 0;

  constructor(config: AudioRecorderConfig = {}) {
    this.config = {
      audioProcessConfig: config.audioProcessConfig || DEFAULT_AUDIO_CONFIG,
      onAudioData: config.onAudioData || (() => {}),
      onAudioLevel: config.onAudioLevel || (() => {}),
      onError: config.onError || ((err) => console.error("[AudioRecorder] Error:", err)),
    };
  }

  /**
   * Start recording
   */
  async start(): Promise<void> {
    if (this.isRecording) {
      console.warn("[AudioRecorder] Already recording");
      return;
    }

    try {
      console.log("[AudioRecorder] 🎤 Starting...");

      // Request microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 24000,
          sampleSize: 16,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          latency: 0.01,
          volume: 1.0,
        } as any,
      });

      console.log("[AudioRecorder] ✅ Microphone access granted");

      // Setup MediaRecorder for local recording
      await this.setupMediaRecorder();

      // Setup AudioContext for STT processing
      await this.setupAudioProcessing();

      // Start audio level monitoring
      this.startAudioLevelMonitoring();

      this.isRecording = true;
      console.log("[AudioRecorder] ✅ Recording started");
    } catch (error) {
      console.error("[AudioRecorder] ❌ Failed to start:", error);
      this.config.onError(error as Error);
      throw error;
    }
  }

  /**
   * Stop recording
   */
  stop(): void {
    if (!this.isRecording) {
      console.warn("[AudioRecorder] Not recording");
      return;
    }

    console.log("[AudioRecorder] ⏹️ Stopping...");

    this.isRecording = false;

    // Stop animation
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Stop MediaRecorder
    if (this.mediaRecorder?.state !== "inactive") {
      this.mediaRecorder?.stop();
    }
    this.mediaRecorder = null;

    // Disconnect audio nodes
    this.processor?.disconnect();
    this.processor = null;
    this.analyser?.disconnect();
    this.analyser = null;

    // Close AudioContext
    this.audioContext?.close();
    this.audioContext = null;

    // Stop media stream
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    console.log("[AudioRecorder] ✅ Stopped");
  }

  /**
   * Get recorded audio blob
   */
  getRecordedBlob(): Blob | null {
    if (this.recordedChunks.length === 0) {
      return null;
    }
    return new Blob(this.recordedChunks, { type: "audio/webm" });
  }

  /**
   * Setup MediaRecorder for local file recording
   */
  private async setupMediaRecorder(): Promise<void> {
    if (!this.stream) return;

    const mimeType =
      ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((type) =>
        MediaRecorder.isTypeSupported(type)
      ) || "audio/webm";

    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data?.size > 0) {
        this.recordedChunks.push(e.data);
      }
    };
    this.mediaRecorder.onstart = () => {
      this.recordedChunks = [];
    };
    this.mediaRecorder.start(100);
  }

  /**
   * Setup AudioContext and audio processing
   */
  private async setupAudioProcessing(): Promise<void> {
    if (!this.stream) return;

    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(this.stream);

    // Analyser for audio level meter
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);

    // ScriptProcessor for audio processing
    this.processor = this.audioContext.createScriptProcessor(2048, 1, 1);
    this.audioChunksSent = 0;

    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.isRecording || !this.audioContext) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const sampleRate = this.audioContext.sampleRate;

      // Process audio chunk
      const base64Audio = processAudioChunk(inputData, sampleRate, this.config.audioProcessConfig);

      if (base64Audio) {
        this.config.onAudioData(base64Audio);

        if (++this.audioChunksSent === 1) {
          console.log("[AudioRecorder] ✅ First chunk sent");
        }
      }
    };

    this.analyser.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  /**
   * Start audio level monitoring
   */
  private startAudioLevelMonitoring(): void {
    const updateAudioLevel = () => {
      if (!this.analyser || !this.isRecording) return;

      const data = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteTimeDomainData(data);

      const rms = Math.sqrt(
        data.reduce((sum, val) => {
          const norm = (val - 128) / 128;
          return sum + norm * norm;
        }, 0) / data.length
      );

      const level = Math.min(100, Math.round(rms * 500));
      this.config.onAudioLevel(level);

      this.animationFrameId = requestAnimationFrame(updateAudioLevel);
    };

    updateAudioLevel();
  }
}
