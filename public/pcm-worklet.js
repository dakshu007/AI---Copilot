/**
 * Converts the (already 16 kHz) input into interleaved 16-bit PCM frames of ~100 ms and
 * reports per-channel levels for the input meter. Runs on the audio rendering thread.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels = (options && options.processorOptions && options.processorOptions.channels) || 1;
    this.frameSize = Math.round(sampleRate / 10);
    this.buffer = new Int16Array(this.frameSize * this.channels);
    this.offset = 0;
    this.levels = new Float32Array(this.channels);
    this.levelFrames = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const length = input[0].length;
    for (let i = 0; i < length; i += 1) {
      for (let c = 0; c < this.channels; c += 1) {
        const data = input[c] || input[0];
        const sample = Math.max(-1, Math.min(1, data[i] || 0));
        this.buffer[this.offset * this.channels + c] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        this.levels[c] = Math.max(this.levels[c], Math.abs(sample));
      }
      this.offset += 1;
      if (this.offset === this.frameSize) {
        const frame = this.buffer;
        this.port.postMessage({ type: 'frame', frame }, [frame.buffer]);
        this.buffer = new Int16Array(this.frameSize * this.channels);
        this.offset = 0;
        this.levelFrames += 1;
        if (this.levelFrames >= 1) {
          this.port.postMessage({ type: 'levels', levels: Array.from(this.levels) });
          this.levels = new Float32Array(this.channels);
          this.levelFrames = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
