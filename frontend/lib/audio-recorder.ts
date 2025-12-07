/**
 * Audio Recorder for Speech-to-Text
 *
 * Handles microphone access, audio processing, and streaming
 */

import { processAudioChunk, AudioProcessConfig, DEFAULT_AUDIO_CONFIG } from "./audio-utils";

export interface AudioRecorderConfig {
  deviceId?: string;  // 특정 마이크 장치 ID
  useExternalMicMode?: boolean;  // 외부 마이크 모드 (echoCancellation 등 비활성화)
  disableNoiseSuppression?: boolean;  // 노이즈 캔슬링 비활성화 (멀리 있는 마이크 대응)
  disableAutoGainControl?: boolean;   // 자동 게인 컨트롤 비활성화 (우리가 직접 조절)
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
    disableNoiseSuppression: boolean;
    disableAutoGainControl: boolean;
    audioProcessConfig: AudioProcessConfig;
    onAudioData: (base64Audio: string) => void;
    onAudioLevel: (level: number) => void;
    onError: (error: Error) => void;
    onDeviceSelected: (deviceInfo: { deviceId: string; label: string }) => void;
  };
  private isRecording = false;
  private audioChunksSent = 0;

  // Dynamic gain adjustment - 마이크 거리 변화 대응용 공격적 설정
  private recentAudioLevels: number[] = [];
  private readonly AUDIO_LEVEL_HISTORY_SIZE = 30;  // 더 짧은 히스토리로 빠른 반응
  private readonly MIN_GAIN = 1.0;
  private readonly MAX_GAIN = 10.0;  // 최대 게인 대폭 상향 (멀리 있는 마이크 대응)
  private readonly TARGET_AUDIO_LEVEL = 35;  // 목표 레벨 약간 상향
  private readonly GAIN_ADJUSTMENT_INTERVAL = 200;  // 0.2초마다 조정 (더 빠른 반응)
  private gainAdjustmentTimer: NodeJS.Timeout | null = null;

  // 마이크 거리 보정용 추가 상태
  private consecutiveLowLevelCount = 0;
  private consecutiveHighLevelCount = 0;

  constructor(config: AudioRecorderConfig = {}) {
    this.config = {
      deviceId: config.deviceId,
      useExternalMicMode: config.useExternalMicMode || false,
      disableNoiseSuppression: config.disableNoiseSuppression ?? true,  // 기본: 노이즈 캔슬링 비활성화
      disableAutoGainControl: config.disableAutoGainControl ?? true,    // 기본: 자동 게인 비활성화 (우리가 조절)
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
    // 초기 게인을 높게 설정하여 마이크 노이즈 캔슬링에 걸리기 전에 신호 강화
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 3.5;  // 높은 초기 게인 (마이크 거리 변화 대응)
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
   * 마이크 거리 변화에 더 공격적으로 대응
   */
  private startDynamicGainAdjustment(): void {
    this.gainAdjustmentTimer = setInterval(() => {
      if (!this.gainNode || this.recentAudioLevels.length < 5) return;

      // Calculate average audio level (최근 값에 더 가중치)
      const recentLevels = this.recentAudioLevels.slice(-10);
      const avgLevel = recentLevels.reduce((sum, level) => sum + level, 0) / recentLevels.length;

      // 최근 최대값 (피크 기반 조정)
      const peakLevel = Math.max(...recentLevels);

      // Current gain
      const currentGain = this.gainNode.gain.value;

      // Adjust gain based on average level - 더 공격적인 조정
      let newGain = currentGain;
      let rampTime = 0.3;  // 기본 램프 시간

      // 매우 조용함: 마이크가 멀리 있거나 소리가 작음
      if (avgLevel < this.TARGET_AUDIO_LEVEL * 0.3) {
        this.consecutiveLowLevelCount++;
        this.consecutiveHighLevelCount = 0;

        // 연속으로 조용하면 더 공격적으로 증폭
        if (this.consecutiveLowLevelCount > 3) {
          newGain = Math.min(this.MAX_GAIN, currentGain * 1.3);  // 30% 증가
          rampTime = 0.15;  // 더 빠른 반응
        } else {
          newGain = Math.min(this.MAX_GAIN, currentGain * 1.15);  // 15% 증가
        }
      }
      // 조금 조용함
      else if (avgLevel < this.TARGET_AUDIO_LEVEL * 0.6) {
        this.consecutiveLowLevelCount++;
        this.consecutiveHighLevelCount = 0;
        newGain = Math.min(this.MAX_GAIN, currentGain * 1.08);  // 8% 증가
      }
      // 너무 시끄러움: 클리핑 방지
      else if (peakLevel > 85 || avgLevel > this.TARGET_AUDIO_LEVEL * 2.5) {
        this.consecutiveHighLevelCount++;
        this.consecutiveLowLevelCount = 0;

        if (this.consecutiveHighLevelCount > 2) {
          newGain = Math.max(this.MIN_GAIN, currentGain * 0.7);  // 30% 감소
          rampTime = 0.1;  // 빠른 반응 (클리핑 방지)
        } else {
          newGain = Math.max(this.MIN_GAIN, currentGain * 0.85);  // 15% 감소
        }
      }
      // 약간 시끄러움
      else if (avgLevel > this.TARGET_AUDIO_LEVEL * 1.8) {
        this.consecutiveHighLevelCount++;
        this.consecutiveLowLevelCount = 0;
        newGain = Math.max(this.MIN_GAIN, currentGain * 0.92);  // 8% 감소
      }
      // 적정 범위
      else {
        this.consecutiveLowLevelCount = 0;
        this.consecutiveHighLevelCount = 0;
      }

      // Apply new gain smoothly
      if (Math.abs(newGain - currentGain) > 0.05) {
        this.gainNode.gain.setValueAtTime(currentGain, this.audioContext!.currentTime);
        this.gainNode.gain.linearRampToValueAtTime(newGain, this.audioContext!.currentTime + rampTime);
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
      // 노이즈 캔슬링: 마이크 거리 변화에 대응하려면 끄는 게 좋음
      baseConstraints.noiseSuppression = !this.config.disableNoiseSuppression;
      // 자동 게인: 우리가 직접 조절하므로 끄는 게 좋음
      baseConstraints.autoGainControl = !this.config.disableAutoGainControl;
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
