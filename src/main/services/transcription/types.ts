import type { ProviderError } from '@shared/core/retry';
import type { ConnectionTestResult, SpeakerRole, TranscriptSegment, TranscriptionStatus } from '@shared/types';

export interface ChannelInfo {
  label: string;
  role: SpeakerRole;
}

export interface TranscriptionStartOptions {
  sampleRate: number;
  /** One entry per interleaved channel in the PCM frames. Empty for demo playback. */
  channels: ChannelInfo[];
  language: string;
}

export interface TranscriptionCallbacks {
  onSegment(segment: TranscriptSegment): void;
  onStatus(status: TranscriptionStatus, message?: string): void;
  /** `fatal` errors end the session; others are shown and the session continues. */
  onError(error: ProviderError, fatal: boolean): void;
  /** Called by scripted providers when they have nothing more to say. */
  onEnded?(): void;
}

export interface TranscriptionSession {
  /** Interleaved 16-bit PCM frames. */
  sendAudio(frame: Int16Array): void;
  pause(): void;
  resume(): void;
  /** Flush pending audio and wait (bounded) for the last results. */
  finish(): Promise<void>;
  /** Immediately release every resource. Safe to call more than once. */
  close(): void;
}

export interface TranscriptionProvider {
  readonly id: string;
  readonly label: string;
  readonly isDemo: boolean;
  /** True when audio leaves this machine. Used for consent and privacy copy. */
  readonly sendsAudioToCloud: boolean;
  start(options: TranscriptionStartOptions, callbacks: TranscriptionCallbacks): Promise<TranscriptionSession>;
  testConnection(): Promise<ConnectionTestResult>;
}

/** Downmix interleaved PCM to one channel. */
export function downmix(frame: Int16Array, channels: number): Int16Array {
  if (channels <= 1) return frame;
  const out = new Int16Array(Math.floor(frame.length / channels));
  for (let i = 0; i < out.length; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += frame[i * channels + c] ?? 0;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(sum / channels)));
  }
  return out;
}

/** Extract one channel from interleaved PCM. */
export function extractChannel(frame: Int16Array, channels: number, channel: number): Int16Array {
  if (channels <= 1) return frame;
  const out = new Int16Array(Math.floor(frame.length / channels));
  for (let i = 0; i < out.length; i += 1) out[i] = frame[i * channels + channel] ?? 0;
  return out;
}
