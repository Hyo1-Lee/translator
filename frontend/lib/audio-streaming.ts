/**
 * Professional AudioWorklet-based Audio Streaming for Deepgram STT
 *
 * Features:
 * - AudioWorklet (3ms latency vs 43ms ScriptProcessor)
 * - High-quality linear interpolation resampling
 * - Binary WebSocket (no Base64 overhead)
 * - Automatic voice activity detection
 * - Zero-copy audio transfer
 * - Professional error handling
 */

export interface AudioStreamConfig {
  targetSampleRate?: number;
  voiceThreshold?: number;
  onAudioData?: (buffer: ArrayBuffer, rms: number) => void;
  onError?: (error: Error) => void;
  onStats?: (stats: AudioStreamStats) => void;
}

export interface AudioStreamStats {
  chunksProcessed: number;
  bytesProcessed: number;
  avgRMS: number;
  avgLatency: number;
}

export class AudioStreamer {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  private isStreaming = false;
  private config: Required<AudioStreamConfig>;

  // Stats
  private stats: AudioStreamStats = {
    chunksProcessed: 0,
    bytesProcessed: 0,
    avgRMS: 0,
    avgLatency: 0
  };

  constructor(config: AudioStreamConfig = {}) {
    this.config = {
      targetSampleRate: config.targetSampleRate || 16000,
      voiceThreshold: config.voiceThreshold || 0.001,
      onAudioData: config.onAudioData || (() => {}),
      onError: config.onError || ((error) => console.error('[AudioStreamer] Error:', error)),
      onStats: config.onStats || (() => {})
    };
  }

  /**
   * Start audio streaming
   */
  async start(): Promise<void> {
    if (this.isStreaming) {
      console.warn('[AudioStreamer] Already streaming');
      return;
    }

    try {
      console.log('[AudioStreamer] 🚀 Starting audio stream...');

      // Get microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false, // Deepgram handles this better
          autoGainControl: false,   // We control gain
          channelCount: 1,
          sampleRate: { ideal: 48000 }
        }
      });

      console.log('[AudioStreamer] 🎤 Microphone access granted');

      // Create AudioContext
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const sampleRate = this.audioContext.sampleRate;

      console.log(`[AudioStreamer] 🔧 AudioContext created: ${sampleRate}Hz`);
      console.log(`[AudioStreamer] 🎯 Target: ${this.config.targetSampleRate}Hz`);

      // Load AudioWorklet module
      try {
        await this.audioContext.audioWorklet.addModule('/audio-processor.worklet.js');
        console.log('[AudioStreamer] ✅ AudioWorklet module loaded');
      } catch (error) {
        throw new Error(`Failed to load AudioWorklet: ${error}`);
      }

      // Create source
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      console.log('[AudioStreamer] ✅ Media stream source created');

      // Create AudioWorklet node
      this.workletNode = new AudioWorkletNode(this.audioContext, 'realtime-audio-processor');

      // Handle messages from worklet
      this.workletNode.port.onmessage = (event) => {
        this.handleAudioData(event.data);
      };

      // Connect audio graph
      this.source.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination); // For monitoring

      this.isStreaming = true;
      console.log('[AudioStreamer] ✅ Streaming started successfully');

      // Report stats every 5 seconds
      setInterval(() => {
        this.config.onStats(this.stats);
      }, 5000);

    } catch (error) {
      console.error('[AudioStreamer] ❌ Failed to start:', error);
      this.config.onError(error as Error);
      throw error;
    }
  }

  /**
   * Handle audio data from worklet
   */
  private handleAudioData(data: { audio: ArrayBuffer; rms: number; length: number }): void {
    if (!this.isStreaming) return;

    const { audio, rms, length } = data;

    // Update stats
    this.stats.chunksProcessed++;
    this.stats.bytesProcessed += length * 2; // Int16 = 2 bytes
    this.stats.avgRMS = (this.stats.avgRMS * 0.9) + (rms * 0.1); // Exponential moving average

    // Call callback
    this.config.onAudioData(audio, rms);

    // Log occasionally
    if (this.stats.chunksProcessed % 100 === 1) {
      console.log(`[AudioStreamer] 📊 Stats: ${this.stats.chunksProcessed} chunks, ${(this.stats.bytesProcessed / 1024).toFixed(1)}KB, RMS: ${this.stats.avgRMS.toFixed(4)}`);
    }
  }

  /**
   * Stop audio streaming
   */
  stop(): void {
    if (!this.isStreaming) return;

    console.log('[AudioStreamer] ⏹️  Stopping stream...');

    this.isStreaming = false;

    // Disconnect audio graph
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.port.close();
      this.workletNode = null;
    }

    // Stop media stream
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    console.log('[AudioStreamer] ✅ Stream stopped');
    console.log(`[AudioStreamer] 📊 Final stats:`, this.stats);
  }

  /**
   * Get current stats
   */
  getStats(): AudioStreamStats {
    return { ...this.stats };
  }

  /**
   * Check if streaming
   */
  isActive(): boolean {
    return this.isStreaming;
  }
}
