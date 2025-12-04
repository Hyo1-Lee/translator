/**
 * Audio Recorder for Speech-to-Text
 *
 * Handles microphone access, audio processing, and streaming
 */

import { processAudioChunk, AudioProcessConfig, DEFAULT_AUDIO_CONFIG } from "./audio-utils";

export interface AudioRecorderConfig {
  deviceId?: string;  // 특정 마이크 장치 ID
  useExternalMicMode?: boolean;  // 외부 마이크 모드 (echoCancellation 등 비활성화)
  audioProcessConfig?: AudioProcessConfig;
  onAudioData?: (base64Audio: string) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error) => void;
  onDeviceSelected?: (deviceInfo: { deviceId: string; label: string }) => void;  // 실제 선택된 마이크 콜백
}

export class AudioRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private animationFrameId: number | null = null;

  private config: {
    deviceId?: string;
    useExternalMicMode: boolean;
    audioProcessConfig: AudioProcessConfig;
    onAudioData: (base64Audio: string) => void;
    onAudioLevel: (level: number) => void;
    onError: (error: Error) => void;
    onDeviceSelected: (deviceInfo: { deviceId: string; label: string }) => void;
  };
  private isRecording = false;
  private audioChunksSent = 0;

  // Dynamic gain adjustment
  private recentAudioLevels: number[] = [];
  private readonly AUDIO_LEVEL_HISTORY_SIZE = 50;  // Track last 50 measurements (~1 second)
  private readonly MIN_GAIN = 1.0;
  private readonly MAX_GAIN = 4.0;
  private readonly TARGET_AUDIO_LEVEL = 30;  // Target level (0-100 scale)
  private readonly GAIN_ADJUSTMENT_INTERVAL = 500;  // Adjust every 0.5 second (faster response)
  private gainAdjustmentTimer: NodeJS.Timeout | null = null;

  constructor(config: AudioRecorderConfig = {}) {
    this.config = {
      deviceId: config.deviceId,
      useExternalMicMode: config.useExternalMicMode || false,
      audioProcessConfig: config.audioProcessConfig || DEFAULT_AUDIO_CONFIG,
      onAudioData: config.onAudioData || (() => {}),
      onAudioLevel: config.onAudioLevel || (() => {}),
      onError: config.onError || ((err) => console.error("[AudioRecorder] Error:", err)),
      onDeviceSelected: config.onDeviceSelected || (() => {}),
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
      // Try multiple strategies to get the correct microphone
      this.stream = await this.tryGetMicrophoneStream();

      // Get actual selected device info
      const audioTrack = this.stream.getAudioTracks()[0];
      if (audioTrack) {
        const settings = audioTrack.getSettings();
        const actualDeviceId = settings.deviceId || "";
        const actualLabel = audioTrack.label || "Unknown Microphone";

        // Notify about actual selected device
        this.config.onDeviceSelected({
          deviceId: actualDeviceId,
          label: actualLabel,
        });
      }

      // Setup AudioContext for STT processing
      await this.setupAudioProcessing();

      this.isRecording = true;

      // Start audio level monitoring (AFTER setupAudioProcessing and setting isRecording)
      this.startAudioLevelMonitoring();
    } catch (error) {
      this.config.onError(error as Error);
      throw error;
    }
  }

  /**
   * Stop recording
   */
  stop(): void {
    if (!this.isRecording) {
      return;
    }

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
        this.audioChunksSent++;
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
      } else if (avgLevel > this.TARGET_AUDIO_LEVEL * 2.0) {
        // Audio is too loud, decrease gain
        newGain = Math.max(this.MIN_GAIN, currentGain * 0.9);
      }

      // Apply new gain smoothly
      if (newGain !== currentGain) {
        this.gainNode.gain.setValueAtTime(currentGain, this.audioContext!.currentTime);
        this.gainNode.gain.linearRampToValueAtTime(newGain, this.audioContext!.currentTime + 0.5);
      }
    }, this.GAIN_ADJUSTMENT_INTERVAL);
  }

  /**
   * Try multiple strategies to get the microphone stream
   * Mobile browsers often ignore deviceId constraints, so we try multiple approaches
   */
  private async tryGetMicrophoneStream(): Promise<MediaStream> {
    const baseConstraints: MediaTrackConstraints = {
      channelCount: 1,
      // Don't specify sampleRate - let browser choose optimal rate
      // Some external mics don't support specific sample rates
    };

    // External mic mode: disable processing for better quality
    if (this.config.useExternalMicMode) {
      baseConstraints.echoCancellation = false;
      baseConstraints.noiseSuppression = false;
      baseConstraints.autoGainControl = false;
    } else {
      baseConstraints.echoCancellation = true;
      baseConstraints.noiseSuppression = true;
      baseConstraints.autoGainControl = true;
    }

    // If no specific device requested, just use defaults
    if (!this.config.deviceId) {
      return navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
    }

    // Strategy 1: Try with exact deviceId (strictest)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...baseConstraints,
          deviceId: { exact: this.config.deviceId },
        },
      });
      return stream;
    } catch {
      // Continue to next strategy
    }

    // Strategy 2: Try with ideal deviceId (more flexible)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...baseConstraints,
          deviceId: { ideal: this.config.deviceId },
        },
      });
      return stream;
    } catch {
      // Continue to next strategy
    }

    // Strategy 3: Try with deviceId as string (some browsers prefer this)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...baseConstraints,
          deviceId: this.config.deviceId,
        },
      });
      return stream;
    } catch {
      // Continue to next strategy
    }

    // Strategy 4: Try without audio processing constraints (some devices don't support them)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { ideal: this.config.deviceId },
        },
      });
      return stream;
    } catch {
      // Continue to fallback
    }

    // Strategy 5: Fallback to default microphone
    return navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
  }
}
