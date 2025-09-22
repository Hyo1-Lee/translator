// Voice Activity Detection (VAD) for client-side processing
// Reduces server load by only sending actual speech

export class VoiceActivityDetector {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 16000;
    this.silenceThreshold = options.silenceThreshold || 0.01;
    this.silenceDuration = options.silenceDuration || 1000; // ms
    this.minSpeechDuration = options.minSpeechDuration || 500; // ms

    this.isRecording = false;
    this.isSpeaking = false;
    this.speechBuffer = [];
    this.silenceStart = null;
    this.speechStart = null;

    this.audioContext = null;
    this.analyser = null;
    this.processor = null;
    this.stream = null;

    this.onSpeechStart = options.onSpeechStart || (() => {});
    this.onSpeechEnd = options.onSpeechEnd || (() => {});
    this.onAudioData = options.onAudioData || (() => {});
  }

  async start() {
    try {
      // Get microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: this.sampleRate,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // Create audio context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.sampleRate
      });

      // Create analyser for volume detection
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.8;

      // Create script processor for audio processing
      const bufferSize = 2048;
      this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      // Connect nodes
      const source = this.audioContext.createMediaStreamSource(this.stream);
      source.connect(this.analyser);
      this.analyser.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // Process audio
      this.processor.onaudioprocess = (e) => {
        if (!this.isRecording) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const volume = this.calculateRMS(inputData);

        this.processAudioChunk(inputData, volume);
      };

      this.isRecording = true;
      console.log('VAD started');
    } catch (error) {
      console.error('Error starting VAD:', error);
      throw error;
    }
  }

  calculateRMS(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  }

  processAudioChunk(audioData, volume) {
    const now = Date.now();

    if (volume > this.silenceThreshold) {
      // Speech detected
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.speechStart = now;
        this.speechBuffer = [];
        this.onSpeechStart();
        console.log('Speech started');
      }

      // Add to buffer
      this.speechBuffer.push(new Float32Array(audioData));
      this.silenceStart = null;

      // Send audio chunk for real-time processing
      if (this.speechBuffer.length % 10 === 0) { // Every 10 chunks
        const combinedBuffer = this.combineBuffers(this.speechBuffer.slice(-10));
        this.onAudioData(combinedBuffer);
      }

    } else {
      // Silence detected
      if (this.isSpeaking) {
        if (!this.silenceStart) {
          this.silenceStart = now;
        }

        const silenceDuration = now - this.silenceStart;

        // Add silence to buffer (for natural speech)
        if (silenceDuration < 300) {
          this.speechBuffer.push(new Float32Array(audioData));
        }

        // Check if speech ended
        if (silenceDuration >= this.silenceDuration) {
          const speechDuration = now - this.speechStart;

          if (speechDuration >= this.minSpeechDuration && this.speechBuffer.length > 0) {
            // Combine all audio buffers
            const completeAudio = this.combineBuffers(this.speechBuffer);

            // Convert to WAV and send
            const wavBuffer = this.floatTo16BitPCM(completeAudio);
            this.onSpeechEnd(wavBuffer);

            console.log(`Speech ended: ${speechDuration}ms`);
          }

          this.isSpeaking = false;
          this.speechBuffer = [];
          this.silenceStart = null;
        }
      }
    }
  }

  combineBuffers(buffers) {
    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;

    for (const buffer of buffers) {
      combined.set(buffer, offset);
      offset += buffer.length;
    }

    return combined;
  }

  floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;

    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return buffer;
  }

  createWAV(audioBuffer) {
    const length = audioBuffer.byteLength;
    const arrayBuffer = new ArrayBuffer(44 + length);
    const view = new DataView(arrayBuffer);

    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); // channels
    view.setUint32(24, this.sampleRate, true);
    view.setUint32(28, this.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length, true);

    // Copy audio data
    const audioData = new Uint8Array(audioBuffer);
    const outputData = new Uint8Array(arrayBuffer, 44);
    outputData.set(audioData);

    return arrayBuffer;
  }

  stop() {
    this.isRecording = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    console.log('VAD stopped');
  }

  // Get audio level for visualization
  getAudioLevel() {
    if (!this.analyser) return 0;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }

    return sum / dataArray.length / 255;
  }
}