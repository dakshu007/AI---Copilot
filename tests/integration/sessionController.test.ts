import type { AnswerProvider, AnswerRequest, SummaryRequest } from '../../src/main/services/llm/types';
import { SessionController, type SessionControllerDeps } from '../../src/main/services/session/SessionController';
import type {
  TranscriptionCallbacks,
  TranscriptionProvider,
  TranscriptionSession,
  TranscriptionStartOptions,
} from '../../src/main/services/transcription/types';
import { ProviderError } from '../../src/shared/core/retry';
import { SettingsSchema } from '../../src/shared/schemas';
import type { CandidateProfile, ModelAnswer, ModelSummary, SessionEvent, SessionRecord, Settings, StartSessionRequest } from '../../src/shared/types';
import { makeProfile } from '../fixtures/profiles';

class FakeTranscriptionSession implements TranscriptionSession {
  audio: Int16Array[] = [];
  paused = false;
  closed = 0;
  finishBehavior: 'ok' | 'hang' | 'throw' = 'ok';
  sendAudio(frame: Int16Array) {
    if (this.finishBehavior === 'throw' && frame[0] === 999) throw new Error('socket exploded');
    this.audio.push(frame);
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  finish() {
    if (this.finishBehavior === 'hang') return new Promise<void>(() => undefined);
    if (this.finishBehavior === 'throw') return Promise.reject(new Error('finish failed'));
    return Promise.resolve();
  }
  close() {
    this.closed += 1;
  }
}

class FakeTranscriptionProvider implements TranscriptionProvider {
  id = 'fake';
  label = 'Fake STT';
  session = new FakeTranscriptionSession();
  callbacks!: TranscriptionCallbacks;
  options!: TranscriptionStartOptions;
  failStart: Error | null = null;
  constructor(
    public isDemo = false,
    public sendsAudioToCloud = true,
  ) {}
  async start(options: TranscriptionStartOptions, callbacks: TranscriptionCallbacks) {
    if (this.failStart) throw this.failStart;
    this.options = options;
    this.callbacks = callbacks;
    return this.session;
  }
  async testConnection() {
    return { ok: true, message: 'ok' };
  }
  say(text: string, role: 'interviewer' | 'candidate' = 'interviewer') {
    this.callbacks.onSegment({ id: `seg-${Math.random()}`, text, startMs: 0, status: 'final', role, speaker: role === 'candidate' ? 'You' : 'Interviewer' });
  }
}

const MODEL_ANSWER: ModelAnswer = {
  answer: 'Grounded answer.',
  evidenceUsed: ['E1'],
  unsupportedClaims: [],
  insufficientResumeEvidence: false,
  generalExplanation: null,
  followUpQuestion: null,
  whyThisAnswer: 'Because.',
};

class FakeAnswerProvider implements AnswerProvider {
  id = 'fake-llm';
  label = 'Fake LLM';
  requests: AnswerRequest[] = [];
  impl: (request: AnswerRequest) => Promise<ModelAnswer> = async () => MODEL_ANSWER;
  constructor(public isDemo = false) {}
  generate(request: AnswerRequest) {
    this.requests.push(request);
    return this.impl(request);
  }
  summaryRequests: SummaryRequest[] = [];
  summarizeImpl: (request: SummaryRequest) => Promise<ModelSummary> = async () => ({
    summary: 'Discussed the release.',
    decisions: ['Ship on Friday'],
    actionItems: [{ task: 'Send the plan', owner: 'You', due: 'today' }],
    openQuestions: [],
  });
  summarize(request: SummaryRequest) {
    this.summaryRequests.push(request);
    return this.summarizeImpl(request);
  }
  async testConnection() {
    return { ok: true, message: 'ok' };
  }
}

function setup(options: { settings?: Partial<Record<keyof Settings, object>>; profile?: CandidateProfile | null } = {}) {
  const events: SessionEvent[] = [];
  let settings = SettingsSchema.parse({
    privacy: { consentLlm: true, consentTranscription: true, historyEnabled: true },
    ...options.settings,
  });
  const stt = new FakeTranscriptionProvider();
  const llm = new FakeAnswerProvider();
  const saved: SessionRecord[] = [];
  const deps: SessionControllerDeps = {
    getSettings: () => settings,
    getProfile: async () => (options.profile === undefined ? makeProfile() : options.profile),
    getJob: async () => null,
    createTranscription: vi.fn(() => stt),
    createAnswerProvider: vi.fn(() => llm),
    saveSession: async (record) => void saved.push(record),
    emit: (event) => events.push(event),
    detectorDebounceMs: 50,
    finishTimeoutMs: 100,
    answerRetries: 1,
  };
  const controller = new SessionController(deps);
  return {
    controller,
    events,
    stt,
    llm,
    saved,
    deps,
    setSettings: (next: Settings) => (settings = next),
    states: () => events.filter((e) => e.type === 'state').map((e) => (e as { state: string }).state),
    ofType: <T extends SessionEvent['type']>(type: T) => events.filter((e): e is Extract<SessionEvent, { type: T }> => e.type === type),
  };
}

const LIVE: StartSessionRequest = { mode: 'assist', audioChannels: 2, sampleRate: 16_000, channelLabels: ['You', 'Interviewer'], demo: false, permittedAcknowledged: true };

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe('SessionController', () => {
  it('requires the permitted-assistance acknowledgement in assist mode', async () => {
    const { controller } = setup();
    await expect(controller.start({ ...LIVE, permittedAcknowledged: false })).rejects.toThrow(/organizer permits/);
    expect(controller.getState()).toBe('idle');
  });

  it('requires consent before streaming audio to a cloud provider', async () => {
    const t = setup({ settings: { privacy: { consentTranscription: false, consentLlm: true } } });
    await expect(t.controller.start(LIVE)).rejects.toThrow(/Consent needed/);
    expect(t.controller.getState()).toBe('idle');
  });

  it('starts, maps channels to speaker roles and forwards audio only while listening', async () => {
    const t = setup();
    await t.controller.start(LIVE);
    expect(t.controller.getState()).toBe('listening');
    expect(t.stt.options.channels).toEqual([
      { label: 'You', role: 'candidate' },
      { label: 'Interviewer', role: 'interviewer' },
    ]);
    t.controller.ingestAudio(new Int16Array([1]));
    t.controller.pause();
    expect(t.stt.session.paused).toBe(true);
    t.controller.ingestAudio(new Int16Array([2]));
    t.controller.resume();
    t.controller.ingestAudio(new Int16Array([3]));
    expect(t.stt.session.audio.map((f) => f[0])).toEqual([1, 3]);
    expect(t.states()).toEqual(['listening', 'paused', 'listening']);
    await t.controller.stop();
  });

  it('refuses a second concurrent session', async () => {
    const t = setup();
    await t.controller.start(LIVE);
    await expect(t.controller.start(LIVE)).rejects.toThrow(/already running/);
    await t.controller.stop();
  });

  it('detects interviewer questions, ignores the candidate, and generates one answer per question', async () => {
    const t = setup();
    await t.controller.start(LIVE);
    t.stt.say('Tell me about a time you led an incident response.');
    t.stt.say('How would you approach that question?', 'candidate');
    await tick(80);
    t.stt.say('Tell me about a time you led an incident response.');
    await tick(80);
    await tick();

    const questions = t.ofType('question');
    expect(questions).toHaveLength(1);
    expect(questions[0]!.question.type).toBe('behavioral');
    const answers = t.ofType('answer');
    expect(answers).toHaveLength(1);
    expect(answers[0]!.suggestion).toMatchObject({ questionId: questions[0]!.question.id, format: 'star', answer: 'Grounded answer.', provider: 'Fake LLM' });
    expect(t.llm.requests[0]!.context.hasProfile).toBe(true);
    expect(t.llm.requests[0]!.context.text).toContain('Interviewer: Tell me about a time');
    await t.controller.stop();
  });

  it('does not use an unconfirmed profile and says so', async () => {
    const t = setup({ profile: makeProfile({ verified: false }) });
    await t.controller.start(LIVE);
    t.controller.markQuestion('What is your biggest achievement?');
    await tick(10);
    expect(t.llm.requests[0]!.context.hasProfile).toBe(false);
    expect(t.ofType('notice').some((n) => /not been confirmed/.test(n.message))).toBe(true);
    await t.controller.stop();
  });

  it('requires consent before sending context to the AI provider', async () => {
    const t = setup({ settings: { privacy: { consentLlm: false, consentTranscription: true } } });
    await t.controller.start(LIVE);
    t.controller.markQuestion('Why this company?');
    await tick(10);
    expect(t.llm.requests).toHaveLength(0);
    expect(t.ofType('answer-error')[0]).toMatchObject({ retryable: false });
    expect(t.ofType('answer-error')[0]!.message).toMatch(/Consent needed/);
    await t.controller.stop();
  });

  it('retries transient failures a bounded number of times and reports the error', async () => {
    const t = setup();
    t.llm.impl = async () => {
      throw new ProviderError('busy', { retryable: true, retryAfterMs: 1 });
    };
    await t.controller.start({ ...LIVE, audioChannels: 0, mode: 'practice' });
    t.controller.markQuestion('Explain CAP theorem.');
    await tick(50);
    expect(t.llm.requests).toHaveLength(2);
    expect(t.ofType('answer-error')[0]).toMatchObject({ message: 'busy', retryable: true });
    await t.controller.stop();
  });

  it('regenerates in another style and supports cancellation', async () => {
    const t = setup({ settings: { answers: { autoGenerate: false } } });
    t.llm.impl = (request) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(MODEL_ANSWER), 50);
        request.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new ProviderError('Cancelled', { code: 'cancelled' }));
        });
      });
    await t.controller.start({ ...LIVE, audioChannels: 0, mode: 'practice' });
    const question = t.controller.markQuestion('Explain how HTTPS works.')!;
    expect(t.llm.requests).toHaveLength(0);

    const pending = t.controller.generateAnswer(question.id, 'technical');
    t.controller.cancelAnswer(question.id);
    await pending;
    expect(t.ofType('answer-cancelled')).toHaveLength(1);

    await t.controller.generateAnswer(question.id, 'concise');
    expect(t.ofType('answer')[0]!.suggestion.format).toBe('concise');
    t.controller.setFeedback(question.id, t.ofType('answer')[0]!.suggestion.createdAt, 'useful');
    expect(t.controller.snapshot().answers[0]!.feedback).toBe('useful');
    await t.controller.stop();
  });

  it('always stops cleanly even when the provider hangs on finish', async () => {
    const t = setup();
    await t.controller.start(LIVE);
    t.stt.session.finishBehavior = 'hang';
    await t.controller.stop();
    expect(t.controller.getState()).toBe('idle');
    expect(t.stt.session.closed).toBe(1);
    expect(t.states().slice(-2)).toEqual(['stopping', 'idle']);
  });

  it('always stops cleanly even when the provider throws', async () => {
    const t = setup();
    await t.controller.start(LIVE);
    t.stt.session.finishBehavior = 'throw';
    t.controller.ingestAudio(new Int16Array([999]));
    expect(t.ofType('notice').length).toBeGreaterThan(0);
    await t.controller.stop();
    expect(t.controller.getState()).toBe('idle');
    expect(t.stt.session.closed).toBe(1);
  });

  it('aborts in-flight answers when stopping', async () => {
    const t = setup();
    let aborted = false;
    t.llm.impl = (request) =>
      new Promise((_resolve, reject) =>
        request.signal.addEventListener('abort', () => {
          aborted = true;
          reject(new ProviderError('Cancelled', { code: 'cancelled' }));
        }),
      );
    await t.controller.start(LIVE);
    t.controller.markQuestion('Tell me about yourself.');
    await tick(5);
    await t.controller.stop();
    await tick(5);
    expect(aborted).toBe(true);
  });

  it('moves to an error state and releases the provider on fatal transcription errors', async () => {
    const t = setup();
    await t.controller.start(LIVE);
    t.stt.callbacks.onError(new ProviderError('Deepgram rejected the API key.'), true);
    expect(t.controller.getState()).toBe('error');
    expect(t.stt.session.closed).toBe(1);
    expect(t.ofType('state').at(-1)).toMatchObject({ state: 'error', message: 'Deepgram rejected the API key.' });
    // Non-fatal errors are just notices.
    await t.controller.stop();
    expect(t.controller.getState()).toBe('idle');
    await t.controller.start(LIVE);
    t.stt.callbacks.onError(new ProviderError('One chunk failed.'), false);
    expect(t.controller.getState()).toBe('listening');
    await t.controller.stop();
  });

  it('surfaces provider start failures and stays idle', async () => {
    const t = setup();
    t.stt.failStart = new ProviderError('Could not connect to Deepgram.');
    await expect(t.controller.start(LIVE)).rejects.toThrow('Could not connect to Deepgram.');
    expect(t.controller.getState()).toBe('idle');
    (t.deps.createTranscription as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Add your Deepgram API key in Settings first.');
    });
    await expect(t.controller.start(LIVE)).rejects.toThrow('Add your Deepgram API key');
  });

  it('marks demo sessions and needs no transcription consent for them', async () => {
    const t = setup({ settings: { privacy: { consentTranscription: false, consentLlm: true } } });
    t.stt.isDemo = true;
    t.stt.sendsAudioToCloud = false;
    await t.controller.start({ ...LIVE, demo: true, audioChannels: 0 });
    expect(t.ofType('state').at(-1)).toMatchObject({ state: 'listening', isDemo: true });
    expect(t.deps.createTranscription).toHaveBeenCalledWith({ forceDemo: true, mode: 'assist' });
    await t.controller.stop();
  });

  it('runs practice sessions without any transcription provider', async () => {
    const t = setup();
    await t.controller.start({ mode: 'practice', audioChannels: 0, sampleRate: 16_000, demo: false, permittedAcknowledged: false });
    expect(t.deps.createTranscription).not.toHaveBeenCalled();
    const q = t.controller.markQuestion('Tell me about yourself.', [], 'practice');
    expect(q!.source).toBe('practice');
    await tick(5);
    await t.controller.stop();
    expect(t.saved[0]!.questions[0]!.source).toBe('practice');
  });

  it('saves history only when enabled, without any credentials', async () => {
    const t = setup();
    await t.controller.start(LIVE);
    t.stt.say('How do you prioritise competing deadlines?');
    await tick(80);
    await tick();
    await t.controller.stop();
    expect(t.saved).toHaveLength(1);
    expect(t.saved[0]!.answers).toHaveLength(1);
    expect(t.saved[0]!.segments[0]!.text).toContain('prioritise');

    const off = setup({ settings: { privacy: { historyEnabled: false, consentLlm: true, consentTranscription: true } } });
    await off.controller.start(LIVE);
    off.stt.say('How do you prioritise competing deadlines?');
    await off.controller.stop();
    expect(off.saved).toHaveLength(0);
  });

  it('stop() is idempotent', async () => {
    const t = setup();
    await t.controller.stop();
    await t.controller.start(LIVE);
    await Promise.all([t.controller.stop(), t.controller.stop()]);
    expect(t.states().filter((s) => s === 'idle')).toHaveLength(1);
  });

  describe('team meeting mode', () => {
    const MEETING: StartSessionRequest = {
      mode: 'meeting',
      audioChannels: 2,
      sampleRate: 16_000,
      channelLabels: ['You', 'Teammates'],
      demo: false,
      permittedAcknowledged: true,
      meetingContext: '- Release moved to Friday 14 Nov\n- Checkout migration blocked on DB credentials',
    };

    it('requires participants to know the meeting is transcribed', async () => {
      const t = setup();
      await expect(t.controller.start({ ...MEETING, permittedAcknowledged: false })).rejects.toThrow(/participants know/);
    });

    it('labels teammates as the other side and uses meeting notes in replies', async () => {
      const t = setup();
      await t.controller.start(MEETING);
      expect(t.stt.options.channels[1]).toEqual({ label: 'Teammates', role: 'interviewer' });
      expect(t.deps.createTranscription).toHaveBeenCalledWith({ forceDemo: false, mode: 'meeting' });
      t.stt.say('When is the release going out?');
      await tick(80);
      await tick();
      const request = t.llm.requests[0]!;
      expect(request.mode).toBe('meeting');
      expect(request.context.text).toContain('VERIFIED WORK FACTS');
      expect(request.context.evidence.some((e) => e.text.includes('Release moved to Friday'))).toBe(true);
      // STAR is never the default in meetings.
      expect(t.ofType('answer')[0]!.suggestion.format).not.toBe('star');
      await t.controller.stop();
    });

    it('summarises the meeting and saves summary and insights to history', async () => {
      const t = setup();
      await t.controller.start(MEETING);
      t.stt.say('Can you send the plan by end of day?');
      t.stt.say('Sure, um, I will send it today.', 'candidate');
      await tick(80);
      await t.controller.stop();

      await t.controller.summarize();
      expect(t.ofType('summary-start')).toHaveLength(1);
      const summary = t.ofType('summary')[0]!.summary;
      expect(summary).toMatchObject({ summary: 'Discussed the release.', provider: 'Fake LLM', isDemo: false });
      const request = t.llm.summaryRequests[0]!;
      expect(request.transcript).toContain('Interviewer: Can you send the plan by end of day?');
      expect(request.transcript).toContain('You: Sure, um, I will send it today.');
      expect(request.meetingContext).toContain('Release moved');
      expect(t.controller.snapshot().summary?.decisions).toEqual(['Ship on Friday']);

      const saved = t.saved.at(-1)!;
      expect(saved.mode).toBe('meeting');
      expect(saved.title).toMatch(/^Team meeting/);
      expect(saved.summary?.actionItems[0]!.task).toBe('Send the plan');
      expect(saved.insights).toMatchObject({ hasSpeakerSeparation: true, fillerCount: 1 });
    });

    it('reports summary errors and needs a transcript and consent', async () => {
      const t = setup();
      await t.controller.summarize();
      expect(t.ofType('summary-error')[0]!.message).toMatch(/no transcript/);

      const noConsent = setup({ settings: { privacy: { consentLlm: false, consentTranscription: true } } });
      await noConsent.controller.start(MEETING);
      noConsent.stt.say('Shall we review the roadmap?');
      await noConsent.controller.summarize();
      expect(noConsent.ofType('summary-error')[0]!.message).toMatch(/Consent needed/);
      expect(noConsent.llm.summaryRequests).toHaveLength(0);
      await noConsent.controller.stop();
    });
  });
});
