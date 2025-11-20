/**
 * AudioWorklet Processor for Real-Time STT
 *
 * Benefits over ScriptProcessor:
 * - Runs in separate audio thread (no UI blocking)
 * - Fixed 128 samples = 3ms latency (vs 43ms)
 * - No double buffering
 * - Future-proof (ScriptProcessor deprecated)
 *
 * Sample Rate Strategy:
 * - Browser: 48000 Hz (native)
 * - Target: 16000 Hz (Deepgram optimal)
 * - Resample ratio: 3:1
 */

class RealtimeAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Configuration
    this.targetSampleRate = 16000;
    this.sourceSampleRate = sampleRate; // Browser's native (usually 48000)
    this.resampleRatio = this.sourceSampleRate / this.targetSampleRate;

    // Resampling buffer for linear interpolation
    this.inputBuffer = [];
    this.phase = 0;

    // Stats
    this.chunksProcessed = 0;
    this.bytesProcessed = 0;

    console.log(`[AudioWorklet] Initialized: ${this.sourceSampleRate}Hz → ${this.targetSampleRate}Hz (ratio: ${this.resampleRatio.toFixed(2)})`);
  }

  /**
   * Main audio processing callback
   * Called every 128 samples @ 48kHz = 2.67ms
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];

    if (!input || !input[0]) {
      return true; // Continue processing
    }

    const inputChannel = input[0]; // Mono channel

    // Add to buffer
    this.inputBuffer.push(...inputChannel);

    // Process when we have enough samples
    const samplesNeeded = Math.floor(this.resampleRatio) * 128; // Rough estimate

    if (this.inputBuffer.length >= samplesNeeded) {
      this.processBuffer();
    }

    return true; // Continue processing
  }

  /**
   * Process accumulated buffer with high-quality resampling
   */
  processBuffer() {
    const inputData = new Float32Array(this.inputBuffer);
    this.inputBuffer = []; // Clear buffer

    // Calculate output length
    const outputLength = Math.floor(inputData.length / this.resampleRatio);
    const outputData = new Float32Array(outputLength);

    // Linear interpolation resampling (high quality)
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * this.resampleRatio + this.phase;
      const index0 = Math.floor(srcIndex);
      const index1 = Math.min(index0 + 1, inputData.length - 1);
      const fraction = srcIndex - index0;

      // Linear interpolation
      outputData[i] = inputData[index0] * (1 - fraction) + inputData[index1] * fraction;
    }

    // Update phase for next iteration
    this.phase = (outputLength * this.resampleRatio + this.phase) % this.resampleRatio;

    // Calculate RMS for voice activity detection
    let sum = 0;
    for (let i = 0; i < outputData.length; i++) {
      sum += outputData[i] * outputData[i];
    }
    const rms = Math.sqrt(sum / outputData.length);

    // Voice activity threshold
    const VOICE_THRESHOLD = 0.001; // Very sensitive

    if (rms < VOICE_THRESHOLD) {
      // Skip silent frames
      return;
    }

    // Convert to Int16 PCM
    const int16Data = new Int16Array(outputData.length);
    for (let i = 0; i < outputData.length; i++) {
      // Moderate amplification (1.5x)
      const amplified = outputData[i] * 1.5;

      // Clamp to [-1, 1]
      const clamped = Math.max(-1, Math.min(1, amplified));

      // Convert to Int16
      int16Data[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    }

    // Send to main thread (zero-copy transfer)
    this.port.postMessage({
      audio: int16Data.buffer,
      rms: rms,
      length: int16Data.length
    }, [int16Data.buffer]); // Transferable!

    this.chunksProcessed++;
    this.bytesProcessed += int16Data.length * 2;

    // Log stats occasionally
    if (this.chunksProcessed % 100 === 1) {
      console.log(`[AudioWorklet] Processed ${this.chunksProcessed} chunks, ${(this.bytesProcessed / 1024).toFixed(1)}KB, RMS: ${rms.toFixed(4)}`);
    }
  }
}

registerProcessor('realtime-audio-processor', RealtimeAudioProcessor);
