import { createId } from '@shared/core/ids';
import { ProviderError, errorFromStatus, isAbortError, redactSecrets, withRetry } from '@shared/core/retry';
import type { ConnectionTestResult } from '@shared/types';
import type {
  ChannelInfo,
  TranscriptionCallbacks,
  TranscriptionProvider,
  TranscriptionSession,
  TranscriptionStartOptions,
} from './types';
import { extractChannel } from './types';
import { encodeWav, rms } from './wav';

export interface WhisperOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** Level above which a 20 ms frame counts as speech. */
  speechThreshold?: number;
  /** Silence after speech that ends an utterance (ms). */
  silenceMs?: number;
  /** Upper bound for one uploaded chunk (ms). */
  maxChunkMs?: number;
  /** Utterances shorter than this are discarded (ms). */
  minSpeechMs?: number;
}

/** Common Whisper hallucinations on near-silent audio. */
const HALLUCINATIONS = /^(thank you\.?|thanks for watching!?|you|bye\.?|\.+|\[.*\]|\(.*\))$/i;

/**
 * Near-real-time transcription for OpenAI-compatible `/audio/transcriptions` endpoints
 * (OpenAI, Groq, local Whisper servers). Audio is split into utterances with a simple
 * energy-based voice activity detector; only speech is uploaded.
 */
export class WhisperChunkedProvider implements TranscriptionProvider {
  readonly id = 'openai-whisper';
  readonly label = 'OpenAI-compatible Whisper (chunked)';
  readonly isDemo = false;
  readonly sendsAudioToCloud: boolean;

  constructor(private readonly options: WhisperOptions) {
    const host = safeHost(options.baseUrl);
    this.sendsAudioToCloud = !['localhost', '127.0.0.1', '[::1]'].includes(host);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const started = Date.now();
    try {
      const response = await fetchImpl(`${trimSlash(this.options.baseUrl)}/models`, {
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return { ok: true, message: 'The transcription endpoint accepted the API key.', latencyMs: Date.now() - started };
      return { ok: false, message: errorFromStatus(response.status, 'The transcription provider').message };
    } catch (error) {
      return { ok: false, message: redactSecrets(`Could not reach the transcription endpoint: ${(error as Error).message}`, [this.options.apiKey]) };
    }
  }

  async start(start: TranscriptionStartOptions, callbacks: TranscriptionCallbacks): Promise<TranscriptionSession> {
    const session = new WhisperSession(start, callbacks, this.options);
    callbacks.onStatus('connected');
    return session;
  }

  /** Upload one mono utterance and return its text. Exposed for tests. */
  async transcribe(samples: Int16Array, sampleRate: number, language: string, signal?: AbortSignal): Promise<string> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const wav = encodeWav(samples, sampleRate);
    return withRetry(
      async () => {
        const form = new FormData();
        form.append('file', new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }), 'utterance.wav');
        form.append('model', this.options.model || 'whisper-1');
        form.append('response_format', 'json');
        if (language) form.append('language', language.slice(0, 2));
        let response: Response;
        try {
          response = await fetchImpl(`${trimSlash(this.options.baseUrl)}/audio/transcriptions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.options.apiKey}` },
            body: form,
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
          });
        } catch (error) {
          if (isAbortError(error) && signal?.aborted) throw new ProviderError('Cancelled', { code: 'cancelled' });
          throw new ProviderError('Network error while transcribing audio.', { code: 'network', retryable: true });
        }
        if (!response.ok) throw errorFromStatus(response.status, 'The transcription provider', response.headers.get('retry-after'));
        const body = (await response.json().catch(() => null)) as { text?: unknown } | null;
        if (!body || typeof body.text !== 'string') {
          throw new ProviderError('The transcription provider returned an unexpected response.', { code: 'invalid-response' });
        }
        return body.text.trim();
      },
      { retries: 2, signal },
    );
  }
}

interface ChannelState {
  info: ChannelInfo;
  index: number;
  buffer: Int16Array[];
  bufferedSamples: number;
  speechSamples: number;
  silenceSamples: number;
  inSpeech: boolean;
  startSample: number;
  segmentId: string | null;
}

class WhisperSession implements TranscriptionSession {
  private readonly channels: ChannelState[];
  private readonly controller = new AbortController();
  private paused = false;
  private closed = false;
  private totalSamples = 0;
  private queue: Promise<void> = Promise.resolve();
  private carry: Int16Array = new Int16Array(0);
  private readonly frameSamples: number;

  constructor(
    private readonly start: TranscriptionStartOptions,
    private readonly callbacks: TranscriptionCallbacks,
    private readonly options: WhisperOptions,
  ) {
    const channels = start.channels.length > 0 ? start.channels : [{ label: 'Speaker', role: 'unknown' as const }];
    this.channels = channels.map((info, index) => ({
      info,
      index,
      buffer: [],
      bufferedSamples: 0,
      speechSamples: 0,
      silenceSamples: 0,
      inSpeech: false,
      startSample: 0,
      segmentId: null,
    }));
    this.frameSamples = Math.round(start.sampleRate * 0.02) * this.channels.length;
  }

  sendAudio(frame: Int16Array): void {
    if (this.paused || this.closed) return;
    // Re-chunk into 20 ms frames for the voice activity detector.
    const combined = new Int16Array(this.carry.length + frame.length);
    combined.set(this.carry);
    combined.set(frame, this.carry.length);
    let offset = 0;
    while (offset + this.frameSamples <= combined.length) {
      this.processFrame(combined.subarray(offset, offset + this.frameSamples));
      offset += this.frameSamples;
    }
    this.carry = combined.slice(offset);
  }

  pause(): void {
    this.paused = true;
    for (const channel of this.channels) this.flushChannel(channel);
  }

  resume(): void {
    this.paused = false;
  }

  async finish(): Promise<void> {
    for (const channel of this.channels) this.flushChannel(channel);
    await Promise.race([this.queue, new Promise((resolve) => setTimeout(resolve, 8_000))]);
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    this.callbacks.onStatus('closed');
  }

  private processFrame(frame: Int16Array): void {
    const perChannel = frame.length / this.channels.length;
    const sampleRate = this.start.sampleRate;
    const threshold = this.options.speechThreshold ?? 0.012;
    const silenceLimit = ((this.options.silenceMs ?? 700) / 1_000) * sampleRate;
    const maxChunk = ((this.options.maxChunkMs ?? 12_000) / 1_000) * sampleRate;
    for (const channel of this.channels) {
      const samples = extractChannel(frame, this.channels.length, channel.index);
      const level = rms(samples);
      const isSpeech = level >= threshold;
      if (isSpeech) {
        if (!channel.inSpeech) {
          channel.inSpeech = true;
          channel.startSample = this.totalSamples;
          channel.segmentId = createId('seg');
          // Show that we heard something before the text arrives.
          this.callbacks.onSegment({
            id: channel.segmentId,
            text: '',
            startMs: Math.round((this.totalSamples / sampleRate) * 1_000),
            speaker: channel.info.label,
            role: channel.info.role,
            status: 'partial',
          });
        }
        channel.speechSamples += samples.length;
        channel.silenceSamples = 0;
      } else if (channel.inSpeech) {
        channel.silenceSamples += samples.length;
      }
      if (channel.inSpeech) {
        channel.buffer.push(samples);
        channel.bufferedSamples += samples.length;
        if (channel.silenceSamples >= silenceLimit || channel.bufferedSamples >= maxChunk) this.flushChannel(channel);
      }
    }
    this.totalSamples += perChannel;
  }

  private flushChannel(channel: ChannelState): void {
    if (!channel.inSpeech || !channel.segmentId) return;
    const minSpeech = ((this.options.minSpeechMs ?? 350) / 1_000) * this.start.sampleRate;
    const audio = concat(channel.buffer, channel.bufferedSamples);
    const segmentId = channel.segmentId;
    const startMs = Math.round((channel.startSample / this.start.sampleRate) * 1_000);
    const endMs = startMs + Math.round((audio.length / this.start.sampleRate) * 1_000);
    const enoughSpeech = channel.speechSamples >= minSpeech;
    channel.buffer = [];
    channel.bufferedSamples = 0;
    channel.speechSamples = 0;
    channel.silenceSamples = 0;
    channel.inSpeech = false;
    channel.segmentId = null;

    const emitFinal = (text: string) =>
      this.callbacks.onSegment({
        id: segmentId,
        text,
        startMs,
        endMs,
        speaker: channel.info.label,
        role: channel.info.role,
        status: 'final',
      });

    if (!enoughSpeech) {
      emitFinal('');
      return;
    }
    const provider = new WhisperChunkedProvider(this.options);
    this.queue = this.queue.then(async () => {
      if (this.closed) return;
      try {
        const text = await provider.transcribe(audio, this.start.sampleRate, this.start.language, this.controller.signal);
        emitFinal(HALLUCINATIONS.test(text) ? '' : text);
      } catch (error) {
        emitFinal('');
        if (isAbortError(error)) return;
        const providerError =
          error instanceof ProviderError ? error : new ProviderError('Transcription failed.', { code: 'network' });
        this.callbacks.onError(providerError, providerError.options.code === 'auth');
      }
    });
  }
}

function concat(parts: Int16Array[], total: number): Int16Array {
  const out = new Int16Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
