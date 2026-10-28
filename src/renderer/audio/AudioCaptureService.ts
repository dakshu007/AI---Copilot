import type { AudioSource } from '@shared/types';

export const CAPTURE_SAMPLE_RATE = 16_000;

export class CaptureError extends Error {
  constructor(
    message: string,
    readonly kind: 'permission' | 'device' | 'system-audio' | 'unsupported' | 'unknown',
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

export interface CaptureStartOptions {
  source: AudioSource;
  microphoneDeviceId?: string;
  onFrame(frame: Int16Array): void;
  onLevels?(levels: number[]): void;
  /** A track ended unexpectedly (device unplugged, permission revoked, sharing stopped). */
  onEnded?(reason: string): void;
}

export interface CaptureInfo {
  channels: 1 | 2;
  channelLabels: string[];
  sampleRate: number;
}

/**
 * Microphone and system-audio capture in the renderer. Capture only starts from an explicit
 * user action, and `stop()` always stops every media track and closes the audio graph.
 */
export class AudioCaptureService {
  private streams: MediaStream[] = [];
  private context: AudioContext | null = null;
  private node: AudioNode | null = null;
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  async start(options: CaptureStartOptions): Promise<CaptureInfo> {
    await this.stop();
    const wantsMic = options.source === 'microphone' || options.source === 'both';
    const wantsSystem = options.source === 'system' || options.source === 'both';
    if (!navigator.mediaDevices?.getUserMedia) throw new CaptureError('Audio capture is not available.', 'unsupported');

    try {
      const sources: MediaStream[] = [];
      if (wantsMic) sources.push(await this.openMicrophone(options.microphoneDeviceId));
      if (wantsSystem) sources.push(await this.openSystemAudio());
      this.streams = sources;

      for (const stream of sources) {
        for (const track of stream.getAudioTracks()) {
          track.addEventListener('ended', () => {
            if (this.running) options.onEnded?.(`${track.label || 'An audio source'} stopped.`);
          });
        }
      }

      const channels = sources.length === 2 ? 2 : 1;
      const channelLabels = options.source === 'both' ? ['You', 'Interviewer'] : options.source === 'system' ? ['Interviewer'] : ['Microphone'];
      const context = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE, latencyHint: 'interactive' });
      this.context = context;
      const merger = context.createChannelMerger(channels);
      sources.forEach((stream, index) => {
        const sourceNode = context.createMediaStreamSource(stream);
        // Downmix each source to mono before merging into its own channel.
        const mono = context.createGain();
        mono.channelCount = 1;
        mono.channelCountMode = 'explicit';
        mono.channelInterpretation = 'speakers';
        sourceNode.connect(mono);
        mono.connect(merger, 0, index);
      });

      this.node = await this.createProcessor(context, merger, channels, options);
      if (context.state === 'suspended') await context.resume();
      this.running = true;
      return { channels, channelLabels, sampleRate: context.sampleRate };
    } catch (error) {
      await this.stop();
      throw toCaptureError(error);
    }
  }

  /** Stop processing audio without releasing the devices. */
  async pause(): Promise<void> {
    if (this.context?.state === 'running') await this.context.suspend();
  }

  async resume(): Promise<void> {
    if (this.context?.state === 'suspended') await this.context.resume();
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const stream of this.streams) for (const track of stream.getTracks()) track.stop();
    this.streams = [];
    try {
      this.node?.disconnect();
    } catch {
      // ignore
    }
    this.node = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') await context.close().catch(() => undefined);
  }

  private async openMicrophone(deviceId?: string): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  }

  private async openSystemAudio(): Promise<MediaStream> {
    let stream: MediaStream;
    try {
      // Chromium requires video for getDisplayMedia; it is stopped immediately and never used.
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (error) {
      throw new CaptureError(
        `System audio could not be captured${error instanceof Error && error.name === 'NotAllowedError' ? ' because permission was denied' : ''}. On macOS, allow "Screen & System Audio Recording" for Interview Copilot in System Settings → Privacy & Security, or use a virtual device such as BlackHole as the microphone.`,
        'system-audio',
      );
    }
    for (const track of stream.getVideoTracks()) {
      track.stop();
      stream.removeTrack(track);
    }
    if (stream.getAudioTracks().length === 0) {
      throw new CaptureError(
        'No system audio track was provided by the operating system. Use a virtual audio device such as BlackHole and select it as the microphone.',
        'system-audio',
      );
    }
    return stream;
  }

  private async createProcessor(
    context: AudioContext,
    input: AudioNode,
    channels: number,
    options: CaptureStartOptions,
  ): Promise<AudioNode> {
    const handle = (data: { type: string; frame?: Int16Array; levels?: number[] }) => {
      if (!this.running) return;
      if (data.type === 'frame' && data.frame) options.onFrame(data.frame);
      else if (data.type === 'levels' && data.levels) options.onLevels?.(data.levels);
    };
    try {
      await context.audioWorklet.addModule(new URL('pcm-worklet.js', document.baseURI).toString());
      const node = new AudioWorkletNode(context, 'pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: channels,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
        processorOptions: { channels },
      });
      node.port.onmessage = (event) => handle(event.data);
      input.connect(node);
      return node;
    } catch {
      return this.createScriptProcessorFallback(context, input, channels, handle);
    }
  }

  /** Fallback for environments where AudioWorklet modules cannot be loaded. */
  private createScriptProcessorFallback(
    context: AudioContext,
    input: AudioNode,
    channels: number,
    handle: (data: { type: string; frame?: Int16Array; levels?: number[] }) => void,
  ): AudioNode {
    const processor = context.createScriptProcessor(2048, channels, channels);
    const sink = context.createGain();
    sink.gain.value = 0;
    processor.onaudioprocess = (event) => {
      const length = event.inputBuffer.length;
      const frame = new Int16Array(length * channels);
      const levels = new Array<number>(channels).fill(0);
      for (let c = 0; c < channels; c += 1) {
        const data = event.inputBuffer.getChannelData(Math.min(c, event.inputBuffer.numberOfChannels - 1));
        for (let i = 0; i < length; i += 1) {
          const sample = Math.max(-1, Math.min(1, data[i] ?? 0));
          frame[i * channels + c] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
          levels[c] = Math.max(levels[c] ?? 0, Math.abs(sample));
        }
      }
      handle({ type: 'frame', frame });
      handle({ type: 'levels', levels });
    };
    input.connect(processor);
    processor.connect(sink);
    sink.connect(context.destination);
    return processor;
  }
}

function toCaptureError(error: unknown): CaptureError {
  if (error instanceof CaptureError) return error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new CaptureError(
      'Microphone access was denied. On macOS, enable Interview Copilot in System Settings → Privacy & Security → Microphone, then try again.',
      'permission',
    );
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new CaptureError('The selected microphone was not found. Choose another input in Settings → Audio.', 'device');
  }
  if (name === 'NotReadableError') {
    return new CaptureError('The microphone is in use by another app or could not be opened.', 'device');
  }
  return new CaptureError(error instanceof Error ? error.message : 'Audio capture failed.', 'unknown');
}

export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'audioinput');
}
