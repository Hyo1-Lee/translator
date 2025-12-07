/**
 * Professional Audio Preprocessing Module
 *
 * Implements state-of-the-art DSP algorithms for speech enhancement:
 * - Pre-emphasis Filter: Boosts high frequencies for better speech clarity
 * - High-pass Filter: Removes low-frequency noise and rumble
 * - Spectral Noise Gate: Frequency-domain noise reduction
 * - Dynamic Range Compression: Normalizes volume levels
 * - Adaptive Gain Control: Auto-adjusts volume based on signal strength
 *
 * Optimized for real-time STT accuracy improvement
 */

export interface AudioPreprocessorConfig {
  sampleRate: number;           // Sample rate in Hz (e.g., 24000)
  preEmphasisAlpha?: number;    // Pre-emphasis coefficient (0.0-1.0), default 0.97
  highpassCutoff?: number;      // High-pass filter cutoff in Hz, default 80
  noiseGateThreshold?: number;  // Noise gate threshold in dB, default -50
  compressionRatio?: number;    // Compression ratio (1-20), default 3
  compressionThreshold?: number;// Compression threshold in dB, default -20
  targetRMS?: number;           // Target RMS for normalization, default 0.1
  adaptiveGainEnabled?: boolean;// Enable adaptive gain control, default true
  distanceCompensationEnabled?: boolean; // 마이크 거리 보정 활성화, default true
  aggressiveGainMode?: boolean; // 공격적 게인 모드 (멀리 있는 마이크 대응), default true
}

export class AudioPreprocessor {
  private config: Required<AudioPreprocessorConfig>;

  // Pre-emphasis filter state
  private preEmphasisPrevSample: number = 0;

  // High-pass filter state (2nd order Butterworth)
  private hpX1: number = 0;
  private hpX2: number = 0;
  private hpY1: number = 0;
  private hpY2: number = 0;

  // Biquad filter coefficients for high-pass
  private hpB0: number = 0;
  private hpB1: number = 0;
  private hpB2: number = 0;
  private hpA1: number = 0;
  private hpA2: number = 0;

  // Adaptive gain state - 마이크 거리 보정용 개선
  private currentGain: number = 1.0;
  private rmsHistory: number[] = [];
  private readonly RMS_HISTORY_SIZE = 15;  // 더 많은 히스토리로 안정성 향상

  // 마이크 거리 보정용 상태
  private distanceGain: number = 1.0;      // 거리 기반 추가 게인
  private consecutiveLowRmsCount: number = 0;
  private consecutiveHighRmsCount: number = 0;
  private estimatedDistance: 'near' | 'medium' | 'far' | 'very_far' = 'medium';

  // Noise profile for spectral subtraction
  private noiseProfile: Float32Array | null = null;
  private noiseEstimationFrames: number = 0;
  private readonly NOISE_ESTIMATION_DURATION = 10; // frames

  constructor(config: AudioPreprocessorConfig) {
    this.config = {
      sampleRate: config.sampleRate,
      preEmphasisAlpha: config.preEmphasisAlpha ?? 0.97,
      highpassCutoff: config.highpassCutoff ?? 80,
      noiseGateThreshold: config.noiseGateThreshold ?? -55,  // 더 낮춰서 스피커 음성도 통과
      compressionRatio: config.compressionRatio ?? 4,       // 압축 강화로 동적 범위 균일화
      compressionThreshold: config.compressionThreshold ?? -25,  // 더 낮은 임계값
      targetRMS: config.targetRMS ?? 0.12,                  // 목표 RMS 약간 상향
      adaptiveGainEnabled: config.adaptiveGainEnabled ?? true,
      distanceCompensationEnabled: config.distanceCompensationEnabled ?? true,
      aggressiveGainMode: config.aggressiveGainMode ?? true
    };

    this.initializeHighpassFilter();
  }

  /**
   * Initialize 2nd order Butterworth high-pass filter
   */
  private initializeHighpassFilter(): void {
    const fc = this.config.highpassCutoff;
    const fs = this.config.sampleRate;
    const omega = 2 * Math.PI * fc / fs;
    const sn = Math.sin(omega);
    const cs = Math.cos(omega);
    const alpha = sn / (2 * 0.707); // Q = 0.707 for Butterworth

    // High-pass filter coefficients
    this.hpB0 = (1 + cs) / 2;
    this.hpB1 = -(1 + cs);
    this.hpB2 = (1 + cs) / 2;
    const a0 = 1 + alpha;
    this.hpA1 = (-2 * cs) / a0;
    this.hpA2 = (1 - alpha) / a0;

    // Normalize
    this.hpB0 /= a0;
    this.hpB1 /= a0;
    this.hpB2 /= a0;
  }

  /**
   * Main processing pipeline
   * Applies all preprocessing steps to the audio buffer
   */
  process(audioBuffer: Buffer): Buffer {
    // Convert buffer to float32 array for processing
    const int16Array = new Int16Array(
      audioBuffer.buffer,
      audioBuffer.byteOffset,
      audioBuffer.byteLength / 2
    );

    const floatData = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      floatData[i] = int16Array[i] / 32768.0; // Normalize to [-1, 1]
    }

    // Apply processing chain
    this.applyPreEmphasis(floatData);
    this.applyHighpassFilter(floatData);
    this.applySpectralNoiseGate(floatData);
    this.applyDynamicRangeCompression(floatData);

    if (this.config.adaptiveGainEnabled) {
      this.applyAdaptiveGain(floatData);
    }

    // Convert back to int16
    const outputInt16 = new Int16Array(floatData.length);
    for (let i = 0; i < floatData.length; i++) {
      const clamped = Math.max(-1, Math.min(1, floatData[i]));
      outputInt16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    }

    return Buffer.from(outputInt16.buffer);
  }

  /**
   * Pre-emphasis Filter
   * Boosts high frequencies to improve speech intelligibility
   * H(z) = 1 - α*z^-1
   */
  private applyPreEmphasis(data: Float32Array): void {
    const alpha = this.config.preEmphasisAlpha;

    for (let i = data.length - 1; i >= 0; i--) {
      const current = data[i];
      data[i] = current - alpha * this.preEmphasisPrevSample;
      this.preEmphasisPrevSample = current;
    }
  }

  /**
   * High-pass Filter (2nd order Butterworth)
   * Removes low-frequency noise and rumble
   */
  private applyHighpassFilter(data: Float32Array): void {
    for (let i = 0; i < data.length; i++) {
      const x0 = data[i];

      // Direct Form II implementation
      const y0 = this.hpB0 * x0 + this.hpB1 * this.hpX1 + this.hpB2 * this.hpX2
                - this.hpA1 * this.hpY1 - this.hpA2 * this.hpY2;

      // Update state
      this.hpX2 = this.hpX1;
      this.hpX1 = x0;
      this.hpY2 = this.hpY1;
      this.hpY1 = y0;

      data[i] = y0;
    }
  }

  /**
   * Spectral Noise Gate (완화된 버전)
   * 마이크 거리 변화와 스피커 출력 상황을 고려하여 덜 공격적으로 적용
   */
  private applySpectralNoiseGate(data: Float32Array): void {
    // Calculate RMS for noise gating
    const rms = this.calculateRMS(data);
    const rmsDb = 20 * Math.log10(rms + 1e-10);

    // Build noise profile during initial frames (더 보수적으로)
    if (this.noiseEstimationFrames < this.NOISE_ESTIMATION_DURATION) {
      // 매우 조용한 프레임만 노이즈로 간주 (임계값 낮춤)
      if (rmsDb < this.config.noiseGateThreshold - 5) {
        if (!this.noiseProfile) {
          this.noiseProfile = new Float32Array(data.length);
          this.noiseProfile.set(data);
        } else {
          // Running average
          for (let i = 0; i < data.length; i++) {
            this.noiseProfile[i] = 0.95 * this.noiseProfile[i] + 0.05 * Math.abs(data[i]);
          }
        }
        this.noiseEstimationFrames++;
      }
    }

    // Apply noise gate - 더 관대하게 적용
    if (rmsDb < this.config.noiseGateThreshold - 10) {
      // 매우 조용한 경우에만 감쇠 (스피커 음성 유지)
      for (let i = 0; i < data.length; i++) {
        data[i] *= 0.1; // -20dB 감쇠 (기존 -40dB보다 완화)
      }
    } else if (rmsDb < this.config.noiseGateThreshold && this.noiseProfile) {
      // 중간 레벨: 부분적 노이즈 제거만 적용
      for (let i = 0; i < data.length; i++) {
        const noiseLevel = this.noiseProfile[i] * 0.3; // 30%만 제거 (기존 50%)
        const sign = data[i] >= 0 ? 1 : -1;
        const magnitude = Math.abs(data[i]);
        data[i] = sign * Math.max(0, magnitude - noiseLevel);
      }
    }
    // 임계값 이상: 그대로 통과 (노이즈 제거 안함)
  }

  /**
   * Dynamic Range Compression
   * Reduces the dynamic range to make quiet sounds louder and loud sounds quieter
   * Improves overall consistency for STT
   */
  private applyDynamicRangeCompression(data: Float32Array): void {
    const ratio = this.config.compressionRatio;
    const thresholdDb = this.config.compressionThreshold;
    const threshold = Math.pow(10, thresholdDb / 20);

    for (let i = 0; i < data.length; i++) {
      const input = Math.abs(data[i]);

      if (input > threshold) {
        // Apply compression above threshold
        const excess = input / threshold;
        const compressed = threshold * Math.pow(excess, 1 / ratio);
        data[i] = (data[i] >= 0 ? 1 : -1) * compressed;
      }
      // Below threshold: no compression (1:1 ratio)
    }

    // Apply makeup gain to compensate for compression
    const makeupGain = Math.pow(ratio, 0.5); // Approximate makeup gain
    for (let i = 0; i < data.length; i++) {
      data[i] *= makeupGain;
    }
  }

  /**
   * Adaptive Gain Control with Distance Compensation
   * 마이크 거리 변화에 공격적으로 대응하여 일관된 볼륨 유지
   */
  private applyAdaptiveGain(data: Float32Array): void {
    const currentRMS = this.calculateRMS(data);

    // Update RMS history
    this.rmsHistory.push(currentRMS);
    if (this.rmsHistory.length > this.RMS_HISTORY_SIZE) {
      this.rmsHistory.shift();
    }

    // Calculate average and recent RMS
    const avgRMS = this.rmsHistory.reduce((a, b) => a + b, 0) / this.rmsHistory.length;
    const recentRMS = this.rmsHistory.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, this.rmsHistory.length);

    // 마이크 거리 추정 및 보정
    if (this.config.distanceCompensationEnabled) {
      this.estimateDistanceAndCompensate(recentRMS);
    }

    // Calculate base target gain
    let targetGain = avgRMS > 0.0005 ? this.config.targetRMS / avgRMS : 1.0;

    // 공격적 게인 모드: 조용한 신호에 더 강하게 대응
    if (this.config.aggressiveGainMode) {
      // RMS가 매우 낮으면 (멀리 있음) 게인을 더 높임
      if (recentRMS < 0.01) {
        this.consecutiveLowRmsCount++;
        this.consecutiveHighRmsCount = 0;

        if (this.consecutiveLowRmsCount > 2) {
          // 연속으로 낮으면 더 공격적 증폭
          targetGain *= 1.5;
        }
      } else if (recentRMS > 0.2) {
        this.consecutiveHighRmsCount++;
        this.consecutiveLowRmsCount = 0;

        if (this.consecutiveHighRmsCount > 2) {
          // 연속으로 높으면 클리핑 방지
          targetGain *= 0.7;
        }
      } else {
        this.consecutiveLowRmsCount = 0;
        this.consecutiveHighRmsCount = 0;
      }
    }

    // Apply distance compensation
    targetGain *= this.distanceGain;

    // Smooth gain changes - 더 빠른 반응을 위해 alpha 상향
    const alpha = this.config.aggressiveGainMode ? 0.25 : 0.15;
    this.currentGain = alpha * targetGain + (1 - alpha) * this.currentGain;

    // 더 넓은 게인 범위 (멀리 있는 마이크 대응)
    const maxGain = this.config.aggressiveGainMode ? 15.0 : 10.0;
    this.currentGain = Math.max(0.3, Math.min(maxGain, this.currentGain));

    // Apply gain
    for (let i = 0; i < data.length; i++) {
      data[i] *= this.currentGain;
    }
  }

  /**
   * 마이크 거리 추정 및 보정
   * RMS 기반으로 마이크 거리를 추정하고 적절한 보정 게인 적용
   */
  private estimateDistanceAndCompensate(recentRMS: number): void {
    // RMS 기반 거리 추정 (1/r² 법칙 고려)
    let newDistance: 'near' | 'medium' | 'far' | 'very_far';
    let baseDistanceGain: number;

    if (recentRMS > 0.15) {
      // 가까움: 마이크 앞에서 말함
      newDistance = 'near';
      baseDistanceGain = 0.8;  // 약간 줄임 (클리핑 방지)
    } else if (recentRMS > 0.05) {
      // 중간: 적정 거리
      newDistance = 'medium';
      baseDistanceGain = 1.0;
    } else if (recentRMS > 0.015) {
      // 멀음: 마이크에서 좀 떨어짐
      newDistance = 'far';
      baseDistanceGain = 1.8;  // 증폭
    } else {
      // 매우 멀음: 마이크에서 많이 떨어짐
      newDistance = 'very_far';
      baseDistanceGain = 3.0;  // 강한 증폭
    }

    // 거리 변화 감지 시 빠르게 대응
    if (newDistance !== this.estimatedDistance) {
      // 급격한 변화 시 즉시 적용
      this.distanceGain = baseDistanceGain;
      this.estimatedDistance = newDistance;
    } else {
      // 점진적 조정
      const alpha = 0.3;
      this.distanceGain = alpha * baseDistanceGain + (1 - alpha) * this.distanceGain;
    }
  }

  /**
   * Calculate RMS (Root Mean Square) of audio signal
   */
  private calculateRMS(data: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  }

  /**
   * Reset processor state
   * Useful when starting a new audio session
   */
  reset(): void {
    this.preEmphasisPrevSample = 0;
    this.hpX1 = 0;
    this.hpX2 = 0;
    this.hpY1 = 0;
    this.hpY2 = 0;
    this.currentGain = 1.0;
    this.rmsHistory = [];
    this.noiseProfile = null;
    this.noiseEstimationFrames = 0;
    // 거리 보정 상태 초기화
    this.distanceGain = 1.0;
    this.consecutiveLowRmsCount = 0;
    this.consecutiveHighRmsCount = 0;
    this.estimatedDistance = 'medium';
  }

  /**
   * Get current processing metrics
   */
  getMetrics() {
    return {
      currentGain: this.currentGain,
      distanceGain: this.distanceGain,
      estimatedDistance: this.estimatedDistance,
      avgRMS: this.rmsHistory.length > 0
        ? this.rmsHistory.reduce((a, b) => a + b, 0) / this.rmsHistory.length
        : 0,
      noiseProfileEstimated: this.noiseEstimationFrames >= this.NOISE_ESTIMATION_DURATION,
      config: this.config
    };
  }
}
