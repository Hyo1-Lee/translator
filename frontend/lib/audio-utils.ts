/**
 * Audio Processing Utilities
 *
 * Handles audio conversion and resampling for STT
 */

export interface AudioProcessConfig {
  targetSampleRate: number;
  rmsThreshold: number;
  amplification: number;
}

export const DEFAULT_AUDIO_CONFIG: AudioProcessConfig = {
  targetSampleRate: 16000,
  rmsThreshold: 0.001,
  amplification: 1.5,
};

/**
 * Downsample audio data to target sample rate
 */
export function resampleAudio(
  inputData: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Float32Array {
  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.floor(inputData.length / ratio);
  const resampled = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    resampled[i] = inputData[Math.floor(i * ratio)];
  }

  return resampled;
}

/**
 * Calculate RMS (Root Mean Square) of audio data
 */
export function calculateRMS(audioData: Float32Array): number {
  const sum = audioData.reduce((acc, val) => acc + val * val, 0);
  return Math.sqrt(sum / audioData.length);
}

/**
 * Convert Float32 audio to Int16 PCM with amplification
 */
export function float32ToInt16(
  audioData: Float32Array,
  amplification: number = 1.0
): Int16Array {
  const int16 = new Int16Array(audioData.length);

  for (let i = 0; i < audioData.length; i++) {
    const sample = Math.max(-1, Math.min(1, audioData[i])) * amplification;
    const clamped = Math.max(-1, Math.min(1, sample));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  return int16;
}

/**
 * Convert Int16Array to Base64 string
 */
export function int16ToBase64(int16Data: Int16Array): string {
  const uint8 = new Uint8Array(int16Data.buffer);
  return btoa(String.fromCharCode(...Array.from(uint8)));
}

/**
 * Process audio chunk for STT
 * Returns base64-encoded audio if above threshold, null otherwise
 */
export function processAudioChunk(
  inputData: Float32Array,
  sourceSampleRate: number,
  config: AudioProcessConfig = DEFAULT_AUDIO_CONFIG
): string | null {
  // Resample to target rate
  const resampled = resampleAudio(inputData, sourceSampleRate, config.targetSampleRate);

  // Calculate RMS
  const rms = calculateRMS(resampled);

  // Check threshold
  if (rms <= config.rmsThreshold) {
    return null;
  }

  // Convert to Int16
  const int16 = float32ToInt16(resampled, config.amplification);

  // Convert to Base64
  return int16ToBase64(int16);
}
