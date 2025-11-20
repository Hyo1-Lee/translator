/**
 * Deepgram-Compatible Audio Streaming
 *
 * Exactly how Deepgram's web demo works:
 * - MediaRecorder API (NOT ScriptProcessor, NOT AudioWorklet)
 * - 250ms chunks (optimal)
 * - audio/webm format (browser native)
 * - Direct Blob transmission (NO Base64, NO conversion)
 *
 * KISS: Keep It Simple, Stupid
 */

export interface DeepgramAudioConfig {
  onAudioChunk: (audioBlob: Blob) => void;
  onError?: (error: Error) => void;
  onStart?: () => void;
  onStop?: () => void;
  timeslice?: number; // Default: 250ms (Deepgram recommended)
}

export class DeepgramAudioCapture {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private config: Required<DeepgramAudioConfig>;
  private isRecording = false;

  // Stats
  private chunksCount = 0;
  private totalBytes = 0;

  constructor(config: DeepgramAudioConfig) {
    this.config = {
      timeslice: 250, // Deepgram recommended: 100-250ms
      onError: (error) => console.error('[DeepgramAudio] Error:', error),
      onStart: () => console.log('[DeepgramAudio] Started'),
      onStop: () => console.log('[DeepgramAudio] Stopped'),
      ...config
    };
  }

  /**
   * Start capturing audio
   * Exactly like Deepgram's demo
   */
  async start(): Promise<void> {
    if (this.isRecording) {
      console.warn('[DeepgramAudio] Already recording');
      return;
    }

    try {
      console.log('[DeepgramAudio] 🎤 Requesting microphone access...');

      // Get microphone - SIMPLE, like Deepgram demo
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: true // That's it! No fancy options needed
      });

      console.log('[DeepgramAudio] ✅ Microphone access granted');

      // Create MediaRecorder with WebM (browser native, efficient)
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg'; // Fallback for Safari

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType
      });

      console.log(`[DeepgramAudio] 📼 MediaRecorder created: ${mimeType}`);

      // Handle data available - EXACTLY like Deepgram demo
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          // Send blob directly, NO conversion!
          this.config.onAudioChunk(event.data);

          // Stats
          this.chunksCount++;
          this.totalBytes += event.data.size;

          if (this.chunksCount % 10 === 1) {
            console.log(`[DeepgramAudio] 📊 Chunks: ${this.chunksCount}, Size: ${(this.totalBytes / 1024).toFixed(1)}KB, Last: ${event.data.size} bytes`);
          }
        }
      };

      this.mediaRecorder.onerror = (event: any) => {
        console.error('[DeepgramAudio] ❌ MediaRecorder error:', event.error);
        this.config.onError(event.error);
      };

      this.mediaRecorder.onstop = () => {
        console.log(`[DeepgramAudio] ⏹️  Stopped. Total: ${this.chunksCount} chunks, ${(this.totalBytes / 1024).toFixed(1)}KB`);
        this.config.onStop();
      };

      // Start recording with timeslice (Deepgram recommended: 250ms)
      this.mediaRecorder.start(this.config.timeslice);
      this.isRecording = true;

      console.log(`[DeepgramAudio] ✅ Recording started (${this.config.timeslice}ms chunks)`);
      this.config.onStart();

    } catch (error) {
      console.error('[DeepgramAudio] ❌ Failed to start:', error);
      this.config.onError(error as Error);
      throw error;
    }
  }

  /**
   * Stop capturing audio
   */
  stop(): void {
    if (!this.isRecording) {
      console.warn('[DeepgramAudio] Not recording');
      return;
    }

    console.log('[DeepgramAudio] ⏹️  Stopping...');

    // Stop MediaRecorder
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    // Stop all tracks
    if (this.stream) {
      this.stream.getTracks().forEach(track => {
        track.stop();
        console.log(`[DeepgramAudio] 🛑 Track stopped: ${track.kind} (${track.label})`);
      });
      this.stream = null;
    }

    this.mediaRecorder = null;
    this.isRecording = false;
  }

  /**
   * Check if recording
   */
  isActive(): boolean {
    return this.isRecording;
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      chunksCount: this.chunksCount,
      totalBytes: this.totalBytes,
      isRecording: this.isRecording
    };
  }
}
