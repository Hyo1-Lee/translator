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
  onMicrophoneFallback?: (reason: string) => void;  // 마이크 폴백 발생 시 콜백
}

export class AudioRecorder {
  public stream: MediaStream | null = null;  // public으로 변경 (디버그 녹음에서 접근)
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
    onMicrophoneFallback: (reason: string) => void;
  };
  private isRecording = false;
  private isPaused = false;
  private audioChunksSent = 0;

  // Dynamic gain adjustment - 마이크 거리 변화 대응용 공격적 설정
  private recentAudioLevels: number[] = [];
  private readonly AUDIO_LEVEL_HISTORY_SIZE = 30;  // 더 짧은 히스토리로 빠른 반응
  private readonly MIN_GAIN = 1.0;
  private readonly MAX_GAIN = 10.0;  // 최대 게인 대폭 상향 (멀리 있는 마이크 대응)
  private readonly TARGET_AUDIO_LEVEL = 35;  // 목표 레벨 약간 상향
  private readonly GAIN_ADJUSTMENT_INTERVAL = 200;  // 0.2초마다 조정 (더 빠른 반응)
  private readonly SILENCE_THRESHOLD = 5;  // 이 레벨 이하는 침묵으로 간주
  private readonly VOICE_THRESHOLD = 10;   // 이 레벨 이상은 음성으로 간주
  private gainAdjustmentTimer: NodeJS.Timeout | null = null;

  // 마이크 거리 보정용 추가 상태
  private consecutiveLowLevelCount = 0;
  private consecutiveHighLevelCount = 0;
  private consecutiveSilenceCount = 0;     // 연속 침묵 카운트
  private initialGain = 3.5;               // 초기 게인 값 저장
  private lastVoiceGain = 3.5;             // 마지막 음성 감지 시 게인 저장

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
      onMicrophoneFallback: config.onMicrophoneFallback || (() => {}),
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
   * Pause recording (keep stream alive, stop sending data)
   */
  pause(): void {
    if (!this.isRecording || this.isPaused) {
      return;
    }
    this.isPaused = true;
    console.log("[AudioRecorder] ⏸️ Paused");
  }

  /**
   * Resume recording
   */
  resume(): void {
    if (!this.isRecording || !this.isPaused) {
      return;
    }
    this.isPaused = false;
    console.log("[AudioRecorder] ▶️ Resumed");
  }

  /**
   * Stop recording
   */
  stop(): void {
    if (!this.isRecording) {
      return;
    }

    this.isRecording = false;
    this.isPaused = false;

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
      if (!this.isRecording || this.isPaused || !this.audioContext) return;

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
   * 마이크 거리 변화에 대응하되, 침묵 시 게인 상승 방지
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

      let newGain = currentGain;
      let rampTime = 0.3;  // 기본 램프 시간

      // ★ 핵심 수정: 침묵 감지 - 게인 조절하지 않음
      if (avgLevel < this.SILENCE_THRESHOLD) {
        this.consecutiveSilenceCount++;
        this.consecutiveLowLevelCount = 0;
        this.consecutiveHighLevelCount = 0;

        // 침묵이 오래 지속되면 (약 5초 = 25회) 서서히 마지막 음성 게인으로 복귀
        if (this.consecutiveSilenceCount > 25) {
          // 게인이 lastVoiceGain보다 높으면 서서히 낮춤
          if (currentGain > this.lastVoiceGain * 1.2) {
            newGain = currentGain * 0.98;  // 2%씩 천천히 감소
            rampTime = 0.5;
          }
        }
        // 침묵 시에는 게인 유지 (증가 안 함)
        // console.log(`[Gain] Silence detected (${avgLevel.toFixed(1)}), maintaining gain`);
      }
      // 음성 감지 시에만 게인 조절
      else if (avgLevel >= this.VOICE_THRESHOLD) {
        this.consecutiveSilenceCount = 0;  // 침묵 카운트 리셋

        // 음성이 너무 작음: 마이크가 멀리 있음
        if (avgLevel < this.TARGET_AUDIO_LEVEL * 0.4) {
          this.consecutiveLowLevelCount++;
          this.consecutiveHighLevelCount = 0;

          // 연속으로 작으면 증폭 (침묵이 아닌 실제 음성일 때만)
          if (this.consecutiveLowLevelCount > 3) {
            newGain = Math.min(this.MAX_GAIN, currentGain * 1.2);  // 20% 증가
            rampTime = 0.2;
          } else {
            newGain = Math.min(this.MAX_GAIN, currentGain * 1.1);  // 10% 증가
          }
        }
        // 음성이 조금 작음
        else if (avgLevel < this.TARGET_AUDIO_LEVEL * 0.7) {
          this.consecutiveLowLevelCount++;
          this.consecutiveHighLevelCount = 0;
          newGain = Math.min(this.MAX_GAIN, currentGain * 1.05);  // 5% 증가
        }
        // 너무 시끄러움: 클리핑 방지 (즉시 대응)
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

        // 음성 감지 시 현재 게인 저장 (나중에 침묵 후 복귀용)
        this.lastVoiceGain = newGain;
      }
      // 중간 레벨 (SILENCE < avgLevel < VOICE): 게인 유지
      else {
        this.consecutiveSilenceCount = 0;
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
      console.log("[AudioRecorder] No deviceId specified, using default microphone");
      return navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
    }

    const requestedDeviceId = this.config.deviceId;
    console.log("[AudioRecorder] Attempting to use deviceId:", requestedDeviceId);

    // Strategy 1: Try with exact deviceId (strictest)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...baseConstraints,
          deviceId: { exact: requestedDeviceId },
        },
      });
      console.log("[AudioRecorder] ✅ Strategy 1 (exact) succeeded");
      return stream;
    } catch (error) {
      console.warn("[AudioRecorder] ⚠️ Strategy 1 (exact) failed:", (error as Error).message);
    }

    // Strategy 2: Try with ideal deviceId (more flexible)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...baseConstraints,
          deviceId: { ideal: requestedDeviceId },
        },
      });
      // Check if we got the requested device
      const actualDeviceId = stream.getAudioTracks()[0]?.getSettings()?.deviceId;
      if (actualDeviceId === requestedDeviceId) {
        console.log("[AudioRecorder] ✅ Strategy 2 (ideal) succeeded - got exact device");
        return stream;
      }
      // Got a different device - notify user
      console.warn("[AudioRecorder] ⚠️ Strategy 2 (ideal) returned different device:", actualDeviceId);
      this.config.onMicrophoneFallback(`선택한 마이크를 사용할 수 없습니다 (deviceId 불일치)`);
      return stream;
    } catch (error) {
      console.warn("[AudioRecorder] ⚠️ Strategy 2 (ideal) failed:", (error as Error).message);
    }

    // Strategy 3: Try with deviceId as string (some browsers prefer this)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...baseConstraints,
          deviceId: requestedDeviceId,
        },
      });
      const actualDeviceId = stream.getAudioTracks()[0]?.getSettings()?.deviceId;
      if (actualDeviceId === requestedDeviceId) {
        console.log("[AudioRecorder] ✅ Strategy 3 (string) succeeded - got exact device");
        return stream;
      }
      console.warn("[AudioRecorder] ⚠️ Strategy 3 (string) returned different device:", actualDeviceId);
      this.config.onMicrophoneFallback(`선택한 마이크를 사용할 수 없습니다`);
      return stream;
    } catch (error) {
      console.warn("[AudioRecorder] ⚠️ Strategy 3 (string) failed:", (error as Error).message);
    }

    // Strategy 4: Try without audio processing constraints (some devices don't support them)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { ideal: requestedDeviceId },
        },
      });
      console.warn("[AudioRecorder] ⚠️ Strategy 4 (no constraints) - audio processing disabled");
      this.config.onMicrophoneFallback(`선택한 마이크가 일부 설정을 지원하지 않습니다`);
      return stream;
    } catch (error) {
      console.warn("[AudioRecorder] ⚠️ Strategy 4 (no constraints) failed:", (error as Error).message);
    }

    // Strategy 5: Fallback to default microphone - CRITICAL WARNING
    console.error("[AudioRecorder] ❌ All strategies failed! Falling back to default microphone");
    this.config.onMicrophoneFallback(
      `❌ 선택한 마이크(${requestedDeviceId.substring(0, 8)}...)를 찾을 수 없습니다. ` +
      `기본 마이크로 녹음됩니다. 마이크 설정을 확인해주세요!`
    );
    return navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
  }
}
