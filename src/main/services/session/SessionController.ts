import { toSuggestion } from '@shared/core/answerParser';
import { computeInsights } from '@shared/core/communicationInsights';
import { buildContext } from '@shared/core/contextBuilder';
import { createId } from '@shared/core/ids';
import { suggestedFormatFor } from '@shared/core/questionClassifier';
import { QuestionDetector } from '@shared/core/questionDetector';
import { ProviderError, isAbortError, withRetry } from '@shared/core/retry';
import { TranscriptStore } from '@shared/core/transcriptStore';
import type {
  AnswerFormat,
  AnswerSuggestion,
  CandidateProfile,
  DetectedQuestion,
  JobContext,
  MeetingSummary,
  SessionEvent,
  SessionMode,
  SessionRecord,
  SessionSnapshot,
  SessionState,
  Settings,
  StartSessionRequest,
  TranscriptSegment,
} from '@shared/types';
import type { AnswerProvider } from '../llm/types';
import type { ChannelInfo, TranscriptionProvider, TranscriptionSession } from '../transcription/types';

export interface SessionControllerDeps {
  getSettings(): Settings;
  getProfile(): Promise<CandidateProfile | null>;
  getJob(): Promise<JobContext | null>;
  createTranscription(options: { forceDemo: boolean; mode: SessionMode }): TranscriptionProvider;
  createAnswerProvider(): AnswerProvider;
  saveSession?(record: SessionRecord): Promise<void>;
  emit(event: SessionEvent): void;
  now?: () => number;
  detectorDebounceMs?: number;
  /** Upper bound for flushing the transcription provider on stop. */
  finishTimeoutMs?: number;
  answerRetries?: number;
}

export class SessionError extends Error {
  override name = 'SessionError';
}

/**
 * Coordinates capture → transcription → question detection → answer generation → stop.
 *
 * Stopping is deliberately defensive: every step is wrapped so the session always returns to
 * `idle` (and every provider connection is closed) even when a provider misbehaves.
 */
export class SessionController {
  private state: SessionState = 'idle';
  private mode: SessionMode | null = null;
  private isDemo = false;
  private sessionId: string | null = null;
  private startedAt = 0;
  private message: string | undefined;
  private transcription: TranscriptionSession | null = null;
  private detector: QuestionDetector | null = null;
  private readonly transcript = new TranscriptStore();
  private questions = new Map<string, DetectedQuestion>();
  private answers = new Map<string, AnswerSuggestion[]>();
  private readonly inflight = new Map<string, AbortController>();
  private answerProvider: AnswerProvider | null = null;
  private stopping = false;
  private endedAt: number | undefined;
  private meetingContext = '';
  private summary: MeetingSummary | undefined;
  private summaryController: AbortController | null = null;
  private notifiedUnverified = false;
  private readonly now: () => number;

  constructor(private readonly deps: SessionControllerDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  getState(): SessionState {
    return this.state;
  }

  snapshot(): SessionSnapshot {
    return {
      state: this.state,
      mode: this.mode,
      isDemo: this.isDemo,
      sessionId: this.sessionId,
      segments: this.transcript.all(),
      questions: [...this.questions.values()],
      answers: [...this.answers.values()].flat(),
      summary: this.summary,
      message: this.message,
    };
  }

  async start(request: StartSessionRequest): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'error') {
      throw new SessionError('A session is already running. Stop it before starting a new one.');
    }
    if (request.mode === 'assist' && !request.permittedAcknowledged) {
      throw new SessionError('Confirm that the interview organizer permits AI assistance before starting.');
    }
    if (request.mode === 'meeting' && !request.permittedAcknowledged) {
      throw new SessionError('Confirm that the participants know this meeting is being transcribed before starting.');
    }
    const settings = this.deps.getSettings();
    const needsTranscription = request.demo || request.audioChannels > 0;

    let provider: TranscriptionProvider | null = null;
    if (needsTranscription) {
      try {
        provider = this.deps.createTranscription({ forceDemo: request.demo, mode: request.mode });
      } catch (error) {
        throw new SessionError((error as Error).message);
      }
      if (provider.sendsAudioToCloud && !settings.privacy.consentTranscription) {
        throw new SessionError(
          `Consent needed: audio will be streamed to ${provider.label}. Enable it in Settings → Privacy, or use Demo mode.`,
        );
      }
    }

    this.resetSessionData();
    this.meetingContext = request.meetingContext?.trim().slice(0, 5_000) ?? '';
    this.endedAt = undefined;
    this.sessionId = createId('session');
    this.startedAt = this.now();
    this.mode = request.mode;
    this.isDemo = Boolean(provider?.isDemo) || request.demo;
    this.message = undefined;
    this.stopping = false;
    this.notifiedUnverified = false;
    this.detector = new QuestionDetector({
      debounceMs: this.deps.detectorDebounceMs,
      now: this.now,
      onQuestion: (question) => this.handleQuestion(question),
    });

    if (provider) {
      const channels = buildChannels(request);
      try {
        this.transcription = await provider.start(
          { sampleRate: request.sampleRate, channels, language: settings.transcription.language },
          {
            onSegment: (segment) => this.handleSegment(segment),
            onStatus: (status, message) => this.deps.emit({ type: 'transcription-status', status, message }),
            onError: (error, fatal) => this.handleTranscriptionError(error, fatal),
            onEnded: () =>
              this.deps.emit({ type: 'notice', level: 'info', message: 'The demo script has finished. Press Stop to end the session.' }),
          },
        );
      } catch (error) {
        this.transcription = null;
        this.detector.dispose();
        this.detector = null;
        this.sessionId = null;
        this.mode = null;
        throw new SessionError(error instanceof Error ? error.message : 'Could not start transcription.');
      }
    }
    this.setState('listening');
  }

  pause(): void {
    if (this.state !== 'listening') return;
    this.transcription?.pause();
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.transcription?.resume();
    this.setState('listening');
  }

  /** Always succeeds and always ends in `idle`. */
  async stop(): Promise<void> {
    if (this.state === 'idle' || this.stopping) return;
    this.stopping = true;
    this.setState('stopping');

    const transcription = this.transcription;
    this.transcription = null;
    if (transcription) {
      const timeout = this.deps.finishTimeoutMs ?? 4_000;
      try {
        await Promise.race([
          transcription.finish(),
          new Promise<void>((resolve) => setTimeout(resolve, timeout)),
        ]);
      } catch {
        // Ignore provider failures while stopping.
      } finally {
        try {
          transcription.close();
        } catch {
          // ignore
        }
      }
    }

    try {
      this.detector?.flush();
    } catch {
      // ignore
    }
    this.detector?.dispose();
    this.detector = null;
    for (const controller of this.inflight.values()) controller.abort();
    this.inflight.clear();

    this.endedAt = this.now();
    await this.persist();
    this.stopping = false;
    this.setState('idle');
  }

  ingestAudio(frame: Int16Array): void {
    if (this.state !== 'listening') return;
    try {
      this.transcription?.sendAudio(frame);
    } catch (error) {
      this.handleTranscriptionError(
        error instanceof ProviderError ? error : new ProviderError('Audio could not be sent for transcription.'),
        false,
      );
    }
  }

  /** User marked transcript text (or typed a question) as a question. */
  markQuestion(text: string, segmentIds: string[] = [], source: 'manual' | 'practice' = 'manual'): DetectedQuestion | null {
    const detector =
      this.detector ??
      new QuestionDetector({ now: this.now, onQuestion: (question) => this.handleQuestion(question) });
    const question = detector.markManual(text, segmentIds, source);
    if (!this.detector) detector.dispose();
    return question;
  }

  async generateAnswer(questionId: string, format?: AnswerFormat): Promise<void> {
    const question = this.questions.get(questionId);
    if (!question) throw new SessionError('That question is no longer available.');
    const settings = this.deps.getSettings();
    const chosenFormat = format ?? this.defaultFormat(question, settings);

    this.inflight.get(questionId)?.abort();
    const controller = new AbortController();
    this.inflight.set(questionId, controller);
    this.deps.emit({ type: 'answer-start', questionId, format: chosenFormat });

    try {
      const provider = this.getAnswerProvider();
      if (!provider.isDemo && !settings.privacy.consentLlm) {
        throw new ProviderError(
          'Consent needed: enable "Send question and relevant profile facts to my AI provider" in Settings → Privacy.',
          { code: 'config' },
        );
      }
      const [profile, job] = await Promise.all([this.deps.getProfile(), this.deps.getJob()]);
      const verifiedProfile = profile?.verified ? profile : null;
      if (profile && !profile.verified && !this.notifiedUnverified) {
        this.notifiedUnverified = true;
        this.deps.emit({
          type: 'notice',
          level: 'warning',
          message: 'Your profile has not been confirmed yet, so answers will not use your resume facts. Review it on the Profile page.',
        });
      }
      const context = buildContext({
        profile: verifiedProfile,
        job,
        question: question.text,
        recentTranscript: this.transcript.recentContext(1_200),
        mode: this.mode ?? undefined,
        meetingContext: this.meetingContext,
      });
      const model = await withRetry(
        () =>
          provider.generate({
            question,
            format: chosenFormat,
            maxWords: settings.answers.maxWords,
            context,
            signal: controller.signal,
            mode: this.mode ?? undefined,
          }),
        {
          retries: this.deps.answerRetries ?? 2,
          signal: controller.signal,
          onRetry: (attempt) =>
            this.deps.emit({ type: 'notice', level: 'info', message: `Retrying answer generation (attempt ${attempt + 1})…` }),
        },
      );
      if (controller.signal.aborted) throw new ProviderError('Cancelled', { code: 'cancelled' });
      const suggestion = toSuggestion({
        model,
        questionId,
        format: chosenFormat,
        provider: provider.label,
        isDemo: provider.isDemo,
        now: this.now(),
        mode: this.mode ?? undefined,
      });
      const list = this.answers.get(questionId) ?? [];
      list.push(suggestion);
      this.answers.set(questionId, list.slice(-5));
      this.deps.emit({ type: 'answer', suggestion });
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        this.deps.emit({ type: 'answer-cancelled', questionId });
      } else {
        const providerError = error instanceof ProviderError ? error : null;
        this.deps.emit({
          type: 'answer-error',
          questionId,
          message: providerError?.message ?? 'Something went wrong while generating the answer.',
          retryable: providerError?.options.code !== 'config' && providerError?.options.code !== 'auth',
        });
      }
    } finally {
      if (this.inflight.get(questionId) === controller) this.inflight.delete(questionId);
    }
  }

  cancelAnswer(questionId: string): void {
    this.inflight.get(questionId)?.abort();
  }

  setFeedback(questionId: string, createdAt: number, feedback: 'useful' | 'not-useful'): void {
    const suggestion = this.answers.get(questionId)?.find((a) => a.createdAt === createdAt);
    if (suggestion) suggestion.feedback = feedback;
  }

  /** Recreate providers next time (e.g. after settings change). */
  invalidateProviders(): void {
    this.answerProvider = null;
  }

  async dispose(): Promise<void> {
    await this.stop();
  }

  /**
   * Summarise the meeting so far (or the finished meeting): decisions, action items and open
   * questions. Uses the configured AI provider, or an offline heuristic in demo mode.
   */
  async summarize(): Promise<void> {
    const finals = this.transcript.finals();
    if (finals.length === 0) {
      this.deps.emit({ type: 'summary-error', message: 'There is no transcript to summarise yet.' });
      return;
    }
    this.summaryController?.abort();
    const controller = new AbortController();
    this.summaryController = controller;
    this.deps.emit({ type: 'summary-start' });
    try {
      const provider = this.getAnswerProvider();
      if (!provider.isDemo && !this.deps.getSettings().privacy.consentLlm) {
        throw new ProviderError(
          'Consent needed: enable "Allow sending … to my AI provider" in Settings → Privacy to summarise with AI.',
          { code: 'config' },
        );
      }
      const lines: string[] = [];
      let total = 0;
      // Most recent ~12k characters keep cost and latency bounded on long meetings.
      for (let i = finals.length - 1; i >= 0 && total < 12_000; i -= 1) {
        const segment = finals[i]!;
        const line = `${segment.role === 'candidate' ? 'You' : segment.speaker ?? 'Speaker'}: ${segment.text.trim()}`;
        lines.unshift(line);
        total += line.length + 1;
      }
      const model = await withRetry(
        () =>
          provider.summarize({
            transcript: lines.join('\n'),
            segments: finals,
            meetingContext: this.meetingContext,
            signal: controller.signal,
          }),
        { retries: this.deps.answerRetries ?? 2, signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      this.summary = { ...model, createdAt: this.now(), provider: provider.label, isDemo: provider.isDemo };
      this.deps.emit({ type: 'summary', summary: this.summary });
      if (this.state === 'idle') await this.persist();
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      this.deps.emit({
        type: 'summary-error',
        message: error instanceof ProviderError ? error.message : 'The meeting could not be summarised.',
      });
    } finally {
      if (this.summaryController === controller) this.summaryController = null;
    }
  }

  private getAnswerProvider(): AnswerProvider {
    if (!this.answerProvider) this.answerProvider = this.deps.createAnswerProvider();
    return this.answerProvider;
  }

  private defaultFormat(question: DetectedQuestion, settings: Settings): AnswerFormat {
    if (this.mode === 'meeting') {
      // STAR suits interviews, not team conversations.
      if (settings.answers.autoStyle && question.type === 'technical') return 'technical';
      return settings.answers.defaultFormat === 'star' ? 'concise' : settings.answers.defaultFormat;
    }
    if (settings.answers.autoStyle) {
      const suggested = suggestedFormatFor(question.type);
      if (suggested !== 'concise') return suggested;
    }
    return settings.answers.defaultFormat;
  }

  private handleSegment(segment: TranscriptSegment): void {
    if (this.state === 'idle') return;
    const stored = this.transcript.upsert(segment);
    this.deps.emit({ type: 'segment', segment: stored });
    this.detector?.ingest(stored);
  }

  private handleQuestion(question: DetectedQuestion): void {
    this.questions.set(question.id, question);
    this.deps.emit({ type: 'question', question });
    const settings = this.deps.getSettings();
    if (settings.answers.autoGenerate && !this.stopping) {
      void this.generateAnswer(question.id);
    }
  }

  private handleTranscriptionError(error: ProviderError, fatal: boolean): void {
    if (!fatal) {
      this.deps.emit({ type: 'notice', level: 'warning', message: error.message });
      return;
    }
    this.message = error.message;
    const transcription = this.transcription;
    this.transcription = null;
    try {
      transcription?.close();
    } catch {
      // ignore
    }
    this.detector?.flush();
    this.detector?.dispose();
    this.detector = null;
    void this.persist();
    this.setState('error', error.message);
  }

  private async persist(): Promise<void> {
    const settings = this.deps.getSettings();
    if (!settings.privacy.historyEnabled || !this.deps.saveSession || !this.sessionId) return;
    const record = this.toRecord();
    if (record.segments.length === 0 && record.questions.length === 0) return;
    try {
      await this.deps.saveSession(record);
    } catch {
      this.deps.emit({ type: 'notice', level: 'error', message: 'The session could not be saved to history.' });
    }
  }

  private toRecord(): SessionRecord {
    const date = new Date(this.startedAt);
    const label = this.mode === 'assist' ? 'Assisted interview' : this.mode === 'meeting' ? 'Team meeting' : 'Practice';
    const segments = this.transcript.finals();
    return {
      id: this.sessionId ?? createId('session'),
      startedAt: this.startedAt,
      endedAt: this.endedAt ?? this.now(),
      mode: this.mode ?? 'practice',
      isDemo: this.isDemo,
      title: `${label}${this.isDemo ? ' (demo)' : ''} — ${date.toLocaleString()}`,
      segments,
      questions: [...this.questions.values()],
      answers: [...this.answers.values()].flat(),
      summary: this.summary,
      insights: segments.length > 0 ? computeInsights(segments) : undefined,
    };
  }

  private resetSessionData(): void {
    this.summaryController?.abort();
    this.summaryController = null;
    this.summary = undefined;
    this.transcript.clear();
    this.questions = new Map();
    this.answers = new Map();
    for (const controller of this.inflight.values()) controller.abort();
    this.inflight.clear();
    this.answerProvider = null;
  }

  private setState(state: SessionState, message?: string): void {
    this.state = state;
    if (message !== undefined) this.message = message;
    this.deps.emit({
      type: 'state',
      state,
      mode: this.mode,
      isDemo: this.isDemo,
      sessionId: this.sessionId,
      message: state === 'error' ? this.message : undefined,
    });
  }
}

function buildChannels(request: StartSessionRequest): ChannelInfo[] {
  if (request.audioChannels === 0) return [];
  const labels = request.channelLabels ?? [];
  const channels: ChannelInfo[] = [];
  for (let i = 0; i < request.audioChannels; i += 1) {
    const label = labels[i] ?? (request.audioChannels === 2 ? (i === 0 ? 'You' : 'Interviewer') : 'Speaker');
    // "interviewer" means "the other side of the conversation" (interviewer or teammates).
    const role = /^you$/i.test(label) ? 'candidate' : /interviewer|teammate|participant|others/i.test(label) ? 'interviewer' : 'unknown';
    channels.push({ label, role });
  }
  return channels;
}
