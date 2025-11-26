/**
 * Audio Recorder for Speech-to-Text
 *
 * Handles microphone access, audio processing, and streaming
 */

import { processAudioChunk, AudioProcessConfig, DEFAULT_AUDIO_CONFIG } from "./audio-utils";

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
  private gainNode: GainNode | null = null;
  private animationFrameId: number | null = null;

  private config: Required<AudioRecorderConfig>;
  private isRecording = false;
  private audioChunksSent = 0;

  // Dynamic gain adjustment
  private recentAudioLevels: number[] = [];
  private readonly AUDIO_LEVEL_HISTORY_SIZE = 50;  // Track last 50 measurements (~1 second)
  private readonly MIN_GAIN = 1.0;
  private readonly MAX_GAIN = 4.0;
  private readonly TARGET_AUDIO_LEVEL = 30;  // Target level (0-100 scale)
  private readonly GAIN_ADJUSTMENT_INTERVAL = 1000;  // Adjust every 1 second
  private gainAdjustmentTimer: NodeJS.Timeout | null = null;

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
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      console.log("[AudioRecorder] ✅ Microphone access granted");

      // Setup AudioContext for STT processing
      await this.setupAudioProcessing();

      this.isRecording = true;

      // Start audio level monitoring (AFTER setupAudioProcessing and setting isRecording)
      this.startAudioLevelMonitoring();

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

    // Stop dynamic gain adjustment
    if (this.gainAdjustmentTimer) {
      clearInterval(this.gainAdjustmentTimer);
      this.gainAdjustmentTimer = null;
    }

    // Disconnect audio nodes
    this.gainNode?.disconnect();
    this.gainNode = null;
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

    // Clear audio level history
    this.recentAudioLevels = [];

    console.log("[AudioRecorder] ✅ Stopped");
  }

  /**
   * Setup AudioContext and audio processing
   */
  private async setupAudioProcessing(): Promise<void> {
    if (!this.stream) return;

    const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("AudioContext not supported");
    }
    this.audioContext = new AudioContextConstructor();
    const source = this.audioContext.createMediaStreamSource(this.stream);

    // GainNode for dynamic volume adjustment
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 2.0;  // Start with moderate gain
    source.connect(this.gainNode);

    // Analyser for audio level meter
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.gainNode.connect(this.analyser);

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

    // Start dynamic gain adjustment
    this.startDynamicGainAdjustment();
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

      // Track audio levels for dynamic gain adjustment
      this.recentAudioLevels.push(level);
      if (this.recentAudioLevels.length > this.AUDIO_LEVEL_HISTORY_SIZE) {
        this.recentAudioLevels.shift();
      }

      this.animationFrameId = requestAnimationFrame(updateAudioLevel);
    };

    updateAudioLevel();
  }

  /**
   * Start dynamic gain adjustment based on audio levels
   */
  private startDynamicGainAdjustment(): void {
    this.gainAdjustmentTimer = setInterval(() => {
      if (!this.gainNode || this.recentAudioLevels.length < 10) return;

      // Calculate average audio level
      const avgLevel = this.recentAudioLevels.reduce((sum, level) => sum + level, 0) / this.recentAudioLevels.length;

      // Current gain
      const currentGain = this.gainNode.gain.value;

      // Adjust gain based on average level
      let newGain = currentGain;

      if (avgLevel < this.TARGET_AUDIO_LEVEL * 0.5) {
        // Audio is too quiet, increase gain
        newGain = Math.min(this.MAX_GAIN, currentGain * 1.1);
        console.log(`[AudioRecorder] 🔊 Audio too quiet (${avgLevel.toFixed(1)}), increasing gain: ${currentGain.toFixed(2)} → ${newGain.toFixed(2)}`);
      } else if (avgLevel > this.TARGET_AUDIO_LEVEL * 2.0) {
        // Audio is too loud, decrease gain
        newGain = Math.max(this.MIN_GAIN, currentGain * 0.9);
        console.log(`[AudioRecorder] 🔉 Audio too loud (${avgLevel.toFixed(1)}), decreasing gain: ${currentGain.toFixed(2)} → ${newGain.toFixed(2)}`);
      }

      // Apply new gain smoothly
      if (newGain !== currentGain) {
        this.gainNode.gain.setValueAtTime(currentGain, this.audioContext!.currentTime);
        this.gainNode.gain.linearRampToValueAtTime(newGain, this.audioContext!.currentTime + 0.5);
      }
    }, this.GAIN_ADJUSTMENT_INTERVAL);
  }
}
