import { createId } from '@shared/core/ids';
import { ProviderError, redactSecrets } from '@shared/core/retry';
import type { ConnectionTestResult } from '@shared/types';
import type {
  TranscriptionCallbacks,
  TranscriptionProvider,
  TranscriptionSession,
  TranscriptionStartOptions,
} from './types';

/** Minimal WebSocket surface we rely on (the WHATWG WebSocket in Node/Electron). */
export interface WebSocketLike {
  readyState: number;
  binaryType: string;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
}

export type WebSocketFactory = (url: string, protocols: string[]) => WebSocketLike;

const OPEN = 1;

export interface DeepgramOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  createWebSocket?: WebSocketFactory;
  maxReconnectAttempts?: number;
  keepAliveMs?: number;
  /** Audio kept while reconnecting, in ms. */
  reconnectBufferMs?: number;
}

interface DeepgramResult {
  type?: string;
  channel_index?: number[];
  is_final?: boolean;
  speech_final?: boolean;
  start?: number;
  duration?: number;
  channel?: { alternatives?: Array<{ transcript?: string; words?: Array<{ speaker?: number }> }> };
}

/**
 * Real-time streaming transcription over Deepgram's WebSocket API. With two channels
 * (microphone + system audio) Deepgram's multichannel mode keeps "You" and "Interviewer"
 * separate without diarization guesswork.
 */
export class DeepgramProvider implements TranscriptionProvider {
  readonly id = 'deepgram';
  readonly label = 'Deepgram (streaming)';
  readonly isDemo = false;
  readonly sendsAudioToCloud = true;

  constructor(private readonly options: DeepgramOptions) {}

  buildUrl(start: TranscriptionStartOptions): string {
    const channels = Math.max(1, start.channels.length);
    const params = new URLSearchParams({
      model: this.options.model || 'nova-3',
      encoding: 'linear16',
      sample_rate: String(start.sampleRate),
      channels: String(channels),
      interim_results: 'true',
      punctuate: 'true',
      smart_format: 'true',
      endpointing: '400',
      utterance_end_ms: '1200',
      vad_events: 'true',
      language: start.language || 'en',
    });
    if (channels > 1) params.set('multichannel', 'true');
    else params.set('diarize', 'true');
    return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const started = Date.now();
    try {
      const response = await fetchImpl('https://api.deepgram.com/v1/projects', {
        headers: { Authorization: `Token ${this.options.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return { ok: true, message: 'Deepgram accepted the API key.', latencyMs: Date.now() - started };
      if (response.status === 401 || response.status === 403) return { ok: false, message: 'Deepgram rejected the API key.' };
      return { ok: false, message: `Deepgram returned HTTP ${response.status}.` };
    } catch (error) {
      return { ok: false, message: redactSecrets(`Could not reach Deepgram: ${(error as Error).message}`, [this.options.apiKey]) };
    }
  }

  async start(start: TranscriptionStartOptions, callbacks: TranscriptionCallbacks): Promise<TranscriptionSession> {
    const session = new DeepgramSession(this.buildUrl(start), start, callbacks, this.options);
    await session.connect();
    return session;
  }
}

class DeepgramSession implements TranscriptionSession {
  private socket: WebSocketLike | null = null;
  private closedByUser = false;
  private paused = false;
  private reconnectAttempts = 0;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingAudio: Int16Array[] = [];
  private pendingSamples = 0;
  private readonly currentIds = new Map<number, string>();
  private finishResolve: (() => void) | null = null;
  private readonly createSocket: WebSocketFactory;

  constructor(
    private readonly url: string,
    private readonly start: TranscriptionStartOptions,
    private readonly callbacks: TranscriptionCallbacks,
    private readonly options: DeepgramOptions,
  ) {
    this.createSocket =
      options.createWebSocket ??
      ((target, protocols) => new WebSocket(target, protocols) as unknown as WebSocketLike);
  }

  connect(): Promise<void> {
    this.callbacks.onStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket: WebSocketLike;
      try {
        // Deepgram accepts the API key as a WebSocket sub-protocol, so it is never in the URL.
        socket = this.createSocket(this.url, ['token', this.options.apiKey]);
      } catch (error) {
        reject(new ProviderError(`Could not open the Deepgram connection: ${(error as Error).message}`, { code: 'network' }));
        return;
      }
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      socket.onopen = () => {
        settled = true;
        this.reconnectAttempts = 0;
        this.callbacks.onStatus('connected');
        this.flushPendingAudio();
        this.startKeepAlive();
        resolve();
      };
      socket.onmessage = (event) => this.handleMessage(event.data);
      socket.onerror = () => {
        // Details arrive with onclose.
      };
      socket.onclose = (event) => {
        this.stopKeepAlive();
        if (this.socket === socket) this.socket = null;
        if (!settled) {
          settled = true;
          const authFailure = event.code === 1008 || /401|unauthori[sz]ed|forbidden/i.test(event.reason);
          reject(
            new ProviderError(
              authFailure
                ? 'Deepgram rejected the API key. Check it in Settings.'
                : `Could not connect to Deepgram${event.reason ? `: ${redactSecrets(event.reason, [this.options.apiKey])}` : '.'}`,
              { code: authFailure ? 'auth' : 'network', retryable: !authFailure },
            ),
          );
          return;
        }
        this.handleUnexpectedClose(event);
      };
    });
  }

  sendAudio(frame: Int16Array): void {
    if (this.closedByUser || this.paused) return;
    if (this.socket && this.socket.readyState === OPEN) {
      this.socket.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
      return;
    }
    // Reconnecting: keep a bounded buffer so a short drop loses as little speech as possible.
    const limit = ((this.options.reconnectBufferMs ?? 5_000) / 1_000) * this.start.sampleRate * Math.max(1, this.start.channels.length);
    this.pendingAudio.push(frame);
    this.pendingSamples += frame.length;
    while (this.pendingSamples > limit && this.pendingAudio.length > 0) {
      this.pendingSamples -= this.pendingAudio.shift()!.length;
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  finish(): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) {
      this.close();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.finishResolve = resolve;
      try {
        socket.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {
        this.close();
        resolve();
        return;
      }
      setTimeout(() => {
        this.close();
        resolve();
      }, 2_500);
    });
  }

  close(): void {
    this.closedByUser = true;
    this.stopKeepAlive();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      try {
        socket.close(1000, 'session ended');
      } catch {
        // ignore
      }
    }
    this.pendingAudio = [];
    this.pendingSamples = 0;
    this.callbacks.onStatus('closed');
    this.finishResolve?.();
    this.finishResolve = null;
  }

  private handleUnexpectedClose(event: { code: number; reason: string }): void {
    if (this.closedByUser) return;
    if (this.finishResolve) {
      // Normal end after CloseStream.
      this.close();
      return;
    }
    const maxAttempts = this.options.maxReconnectAttempts ?? 5;
    if (event.code === 1008 || this.reconnectAttempts >= maxAttempts) {
      this.callbacks.onError(
        new ProviderError(
          event.code === 1008
            ? 'Deepgram closed the connection (authentication or policy error).'
            : 'Lost the connection to Deepgram and could not reconnect. Check your network and start again.',
          { code: 'network' },
        ),
        true,
      );
      this.close();
      return;
    }
    this.reconnectAttempts += 1;
    const delay = Math.min(8_000, 500 * 2 ** (this.reconnectAttempts - 1));
    this.callbacks.onStatus('reconnecting', `Connection lost. Reconnecting (attempt ${this.reconnectAttempts}/${maxAttempts})…`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closedByUser) return;
      this.connect().catch((error: ProviderError) => {
        if (this.closedByUser) return;
        if (error.options.code === 'auth') {
          this.callbacks.onError(error, true);
          this.close();
        } else {
          this.handleUnexpectedClose({ code: 1006, reason: error.message });
        }
      });
    }, delay);
  }

  private flushPendingAudio(): void {
    const pending = this.pendingAudio;
    this.pendingAudio = [];
    this.pendingSamples = 0;
    for (const frame of pending) this.sendAudio(frame);
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAlive = setInterval(() => {
      if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify({ type: 'KeepAlive' }));
    }, this.options.keepAliveMs ?? 8_000);
  }

  private stopKeepAlive(): void {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let message: DeepgramResult;
    try {
      message = JSON.parse(data) as DeepgramResult;
    } catch {
      return;
    }
    if (message.type !== 'Results') return;
    const channelIndex = message.channel_index?.[0] ?? 0;
    const alternative = message.channel?.alternatives?.[0];
    const text = (alternative?.transcript ?? '').trim();
    const channel = this.start.channels[channelIndex];
    let speaker = channel?.label;
    let role = channel?.role ?? 'unknown';
    if (this.start.channels.length <= 1) {
      const speakerIndex = alternative?.words?.find((w) => typeof w.speaker === 'number')?.speaker;
      if (typeof speakerIndex === 'number' && (!channel || channel.role === 'unknown')) {
        speaker = `Speaker ${speakerIndex + 1}`;
        role = 'unknown';
      }
    }

    let id = this.currentIds.get(channelIndex);
    if (!text && !message.is_final) return;
    if (!id) {
      if (!text) return;
      id = createId('seg');
      this.currentIds.set(channelIndex, id);
    }
    const startMs = Math.round((message.start ?? 0) * 1_000);
    const endMs = Math.round(((message.start ?? 0) + (message.duration ?? 0)) * 1_000);
    this.callbacks.onSegment({
      id,
      text,
      startMs,
      endMs,
      speaker: speaker ?? 'Speaker',
      role,
      status: message.is_final ? 'final' : 'partial',
    });
    if (message.is_final) this.currentIds.delete(channelIndex);
  }
}
