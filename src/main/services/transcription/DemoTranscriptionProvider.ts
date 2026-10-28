import { DEMO_SCRIPT, type DemoLine } from '@shared/core/demoScript';
import { createId } from '@shared/core/ids';
import type { ConnectionTestResult } from '@shared/types';
import type { TranscriptionCallbacks, TranscriptionProvider, TranscriptionSession } from './types';

/**
 * Plays a scripted interview so the app can be explored without a microphone or API key.
 * Everything it produces is labelled DEMO in the UI; it ignores any audio it receives.
 */
export class DemoTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'demo';
  readonly label = 'Demo script (no audio)';
  readonly isDemo = true;
  readonly sendsAudioToCloud = false;

  constructor(
    private readonly options: { speed?: number; script?: DemoLine[] } = {},
  ) {}

  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, message: 'Demo transcription needs no connection.' };
  }

  async start(_options: unknown, callbacks: TranscriptionCallbacks): Promise<TranscriptionSession> {
    const session = new DemoSession(this.options.script ?? DEMO_SCRIPT, this.options.speed ?? 1, callbacks);
    callbacks.onStatus('connected');
    session.run();
    return session;
  }
}

class DemoSession implements TranscriptionSession {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lineIndex = 0;
  private wordIndex = 0;
  private segmentId = createId('seg');
  private paused = false;
  private closed = false;
  private elapsedMs = 0;

  constructor(
    private readonly script: DemoLine[],
    private readonly speed: number,
    private readonly callbacks: TranscriptionCallbacks,
  ) {}

  run(): void {
    this.scheduleNext(this.script[0]?.delayMs ?? 0);
  }

  sendAudio(): void {
    // Demo mode ignores audio.
  }

  pause(): void {
    this.paused = true;
    this.clear();
  }

  resume(): void {
    if (!this.paused || this.closed) return;
    this.paused = false;
    this.scheduleNext(300);
  }

  async finish(): Promise<void> {
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clear();
    this.callbacks.onStatus('closed');
  }

  private scheduleNext(delayMs: number): void {
    this.clear();
    if (this.closed || this.paused) return;
    this.timer = setTimeout(() => this.tick(), Math.max(0, delayMs / this.speed));
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const line = this.script[this.lineIndex];
    if (!line) {
      this.callbacks.onEnded?.();
      return;
    }
    const words = line.text.split(' ');
    this.wordIndex = Math.min(words.length, this.wordIndex + 3);
    const done = this.wordIndex >= words.length;
    const stepMs = 220;
    this.elapsedMs += stepMs;
    this.callbacks.onSegment({
      id: this.segmentId,
      text: words.slice(0, this.wordIndex).join(' '),
      startMs: this.elapsedMs,
      speaker: line.speaker,
      // "You" is the user; every other named speaker is another participant.
      role: line.speaker === 'You' ? 'candidate' : 'interviewer',
      status: done ? 'final' : 'partial',
    });
    if (done) {
      this.lineIndex += 1;
      this.wordIndex = 0;
      this.segmentId = createId('seg');
      const next = this.script[this.lineIndex];
      if (next) {
        this.elapsedMs += next.delayMs;
        this.scheduleNext(next.delayMs);
      } else {
        this.callbacks.onEnded?.();
      }
    } else {
      this.scheduleNext(stepMs);
    }
  }
}
