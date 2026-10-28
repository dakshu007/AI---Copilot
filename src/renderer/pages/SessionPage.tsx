import { useCallback, useEffect, useMemo, useState } from 'react';
import { Headphones, MessageSquare, Shield, Shuffle, TriangleAlert } from 'lucide-react';
import { GENERAL_PRACTICE_QUESTIONS, practiceQuestionsForJob, type PracticeQuestion } from '@shared/core/practiceQuestions';
import type { AnswerFormat, AudioSource, JobContext, SessionMode } from '@shared/types';
import { useCopilot } from '../app/CopilotProvider';
import { CaptureStatusIndicator } from '../components/CaptureStatusIndicator';
import { LevelMeter } from '../components/LevelMeter';
import { LiveTranscript } from '../components/LiveTranscript';
import { QuestionCard } from '../components/QuestionCard';
import { ScreenShareNotice } from '../components/ScreenShareNotice';
import { SessionControls } from '../components/SessionControls';
import { api, errorMessage, unwrap } from '../lib/api';
import { MOD, QUESTION_TYPE_LABELS, cx, isMac } from '../lib/format';

const SOURCE_LABELS: Record<AudioSource, string> = {
  microphone: 'Microphone',
  system: 'System audio (interviewer)',
  both: 'Microphone + system audio',
};

export function SessionPage({ onNavigate }: { onNavigate(page: 'profile' | 'settings'): void }) {
  const { settings, session, startSession, pauseSession, resumeSession, stopSession, updateSettings, notify, platform } = useCopilot();
  const [mode, setMode] = useState<SessionMode>(session.mode ?? 'practice');
  const [acknowledged, setAcknowledged] = useState(false);
  const [practiceDemo, setPracticeDemo] = useState(false);
  const [assistDemo, setAssistDemo] = useState(false);
  const [customQuestion, setCustomQuestion] = useState('');
  const [job, setJob] = useState<JobContext | null>(null);
  const [profileConfirmed, setProfileConfirmed] = useState<boolean | null>(null);

  useEffect(() => {
    void unwrap(api().job.get()).then(setJob).catch(() => undefined);
    void unwrap(api().profile.get())
      .then((profile) => setProfileConfirmed(Boolean(profile?.verified)))
      .catch(() => setProfileConfirmed(false));
  }, []);

  useEffect(() => {
    if (session.mode) setMode(session.mode);
  }, [session.mode]);

  const running = session.state === 'listening' || session.state === 'paused' || session.state === 'requesting-permission' || session.state === 'stopping';
  const s = settings?.settings;
  const transcriptionIsDemo = s?.transcription.provider === 'demo';
  const llmIsDemo = s?.llm.provider === 'demo';
  const liveAudio = mode === 'assist' && !assistDemo && !transcriptionIsDemo;
  const needsTranscriptionConsent = liveAudio && !s?.privacy.consentTranscription;
  const needsLlmConsent = !llmIsDemo && !s?.privacy.consentLlm;
  const missingTranscriptionKey = liveAudio && !settings?.secrets.transcription.set;
  const missingLlmKey = !llmIsDemo && !settings?.secrets.llm.set;

  let startDisabledReason: string | undefined;
  if (mode === 'assist' && !acknowledged) startDisabledReason = 'Confirm the organizer permits AI assistance.';
  else if (missingTranscriptionKey) startDisabledReason = 'Add a transcription API key in Settings, or use the demo script.';
  else if (needsTranscriptionConsent) startDisabledReason = 'Allow audio to be sent to your transcription provider (below).';

  const start = useCallback(async () => {
    if (startDisabledReason || running) return;
    await startSession({
      mode,
      demo: mode === 'practice' ? practiceDemo : assistDemo || transcriptionIsDemo,
      useAudio: mode === 'assist',
      permittedAcknowledged: mode === 'practice' ? true : acknowledged,
    });
  }, [acknowledged, assistDemo, mode, practiceDemo, running, startDisabledReason, startSession, transcriptionIsDemo]);

  const markQuestion = useCallback(
    async (text: string, segmentIds: string[] = [], source: 'manual' | 'practice' = 'manual') => {
      try {
        if (mode === 'practice' && !running) {
          await startSession({ mode: 'practice', demo: false, useAudio: false, permittedAcknowledged: true });
        }
        await unwrap(api().session.markQuestion(text, segmentIds, source));
      } catch (error) {
        notify('error', errorMessage(error));
      }
    },
    [mode, notify, running, startSession],
  );

  const generate = (questionId: string, format?: AnswerFormat) =>
    void unwrap(api().session.generate(questionId, format)).catch((error) => notify('error', errorMessage(error)));

  // Window-local shortcuts: they only fire while this window is focused, so they never
  // interfere with Teams/Zoom/Meet shortcuts.
  useEffect(() => {
    if (!s?.ui.hotkeysEnabled) return;
    const onKey = (event: KeyboardEvent) => {
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (!mod) {
        if (event.key === 'Escape') for (const id of Object.keys(session.generating)) void api().session.cancel(id);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (!running) void start();
      } else if (event.key === '.') {
        event.preventDefault();
        if (running || session.state === 'error') void stopSession();
      } else if (event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        if (session.state === 'listening') void pauseSession();
        else if (session.state === 'paused') void resumeSession();
      } else if (event.shiftKey && event.key.toLowerCase() === 'q') {
        const text = window.getSelection()?.toString().trim();
        if (text && text.length >= 3) {
          event.preventDefault();
          void markQuestion(text);
        }
      } else if (event.shiftKey && event.key.toLowerCase() === 'c') {
        const latest = session.questions[0];
        const answers = latest ? session.answers[latest.id] : undefined;
        const answer = answers?.[answers.length - 1];
        if (answer) {
          event.preventDefault();
          void navigator.clipboard.writeText(answer.answer).then(() => notify('info', 'Latest answer copied.'));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [markQuestion, notify, pauseSession, resumeSession, running, s?.ui.hotkeysEnabled, session, start, stopSession]);

  const practiceQuestions = useMemo<PracticeQuestion[]>(
    () => [...practiceQuestionsForJob(job), ...GENERAL_PRACTICE_QUESTIONS],
    [job],
  );

  if (!settings || !s) return null;

  const showTranscript = mode === 'assist' || practiceDemo || session.segments.length > 0;
  const channelLabels = s.audio.source === 'both' ? ['You', 'Interviewer'] : s.audio.source === 'system' ? ['Interviewer'] : ['Mic'];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <section className="card space-y-3 p-3" aria-label="Session setup">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-white/5" role="radiogroup" aria-label="Mode">
            {(['practice', 'assist'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                disabled={running}
                onClick={() => setMode(value)}
                data-testid={`mode-${value}`}
                className={cx(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed',
                  mode === value ? 'bg-white text-slate-900 shadow-sm dark:bg-white/15 dark:text-white' : 'text-slate-600 dark:text-slate-400',
                )}
              >
                {value === 'practice' ? 'Practice mode' : 'Permitted assistance'}
              </button>
            ))}
          </div>

          {mode === 'assist' && (
            <label className="flex items-center gap-2 text-sm">
              <Headphones className="size-4 text-slate-500" aria-hidden />
              <span className="sr-only">Audio source</span>
              <select
                className="input w-auto py-1.5"
                value={s.audio.source}
                disabled={running}
                onChange={(event) => updateSettings({ audio: { source: event.target.value as AudioSource } })}
                data-testid="audio-source"
              >
                {(Object.keys(SOURCE_LABELS) as AudioSource[]).map((source) => (
                  <option key={source} value={source}>
                    {SOURCE_LABELS[source]}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              className="size-4 accent-violet-600"
              checked={mode === 'practice' ? practiceDemo : assistDemo || transcriptionIsDemo}
              disabled={running || (mode === 'assist' && transcriptionIsDemo)}
              onChange={(event) => (mode === 'practice' ? setPracticeDemo(event.target.checked) : setAssistDemo(event.target.checked))}
              data-testid="demo-toggle"
            />
            {mode === 'practice' ? 'Play demo interview' : 'Use demo script (no audio)'}
          </label>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            {session.levels.length > 0 && session.state === 'listening' && <LevelMeter levels={session.levels} labels={channelLabels} />}
            <SessionControls
              state={session.state}
              canStart={!startDisabledReason}
              startDisabledReason={startDisabledReason}
              startLabel={mode === 'practice' ? 'Start practice' : 'Start session'}
              onStart={start}
              onPause={pauseSession}
              onResume={resumeSession}
              onStop={stopSession}
            />
          </div>
        </div>

        {mode === 'assist' && !running && (
          <div className="rounded-lg border border-accent-200 bg-accent-50/60 p-3 text-sm dark:border-accent-400/20 dark:bg-accent-500/10">
            <p className="flex items-center gap-1.5 font-semibold text-accent-800 dark:text-accent-200">
              <Shield className="size-4" aria-hidden /> Use live assistance only where it is allowed
            </p>
            <p className="mt-1 text-slate-700 dark:text-slate-300">
              Many interviews prohibit AI help. Only continue if the interview organizer has told you AI assistance is permitted. This app does not hide itself
              from screen sharing.
            </p>
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                className="size-4 accent-indigo-600"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                data-testid="permitted-ack"
              />
              The interview organizer permits AI assistance for this session.
            </label>
            {liveAudio && s.audio.source !== 'microphone' && platform && !platform.systemAudio.supported && (
              <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">{platform.systemAudio.note}</p>
            )}
          </div>
        )}

        {(needsTranscriptionConsent || needsLlmConsent) && !running && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-400/30 dark:bg-amber-500/10" data-testid="consent-panel">
            <p className="font-semibold text-amber-900 dark:text-amber-100">Your consent is needed before data leaves this Mac</p>
            {needsTranscriptionConsent && (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={false}
                  onChange={() => updateSettings({ privacy: { consentTranscription: true } })}
                />
                Stream microphone/system audio to {s.transcription.provider === 'deepgram' ? 'Deepgram' : 'my transcription provider'} for transcription.
              </label>
            )}
            {needsLlmConsent && (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={false}
                  onChange={() => updateSettings({ privacy: { consentLlm: true } })}
                  data-testid="consent-llm"
                />
                Send detected questions, recent transcript lines and relevant profile facts to {s.llm.provider === 'anthropic' ? 'Anthropic' : 'my AI provider'} to generate answers.
              </label>
            )}
          </div>
        )}

        {(missingLlmKey || profileConfirmed === false) && !running && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            {profileConfirmed === false && (
              <li>
                Answers won't use resume facts until you{' '}
                <button type="button" className="font-semibold text-accent-600 underline dark:text-accent-300" onClick={() => onNavigate('profile')}>
                  confirm your profile
                </button>
                .
              </li>
            )}
            {missingLlmKey && (
              <li>
                Add an API key in{' '}
                <button type="button" className="font-semibold text-accent-600 underline dark:text-accent-300" onClick={() => onNavigate('settings')}>
                  Settings
                </button>{' '}
                to generate AI answers.
              </li>
            )}
          </ul>
        )}

        {session.state === 'error' && session.message && (
          <div className="flex flex-wrap items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200" role="alert" data-testid="session-error">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="flex-1">{session.message}</p>
            {isMac && /microphone|system audio|screen/i.test(session.message) && (
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => api().app.openPrivacySettings(/system audio|screen/i.test(session.message ?? '') ? 'screen' : 'microphone')}
              >
                Open System Settings
              </button>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <CaptureStatusIndicator
          state={session.state}
          isDemo={session.isDemo}
          usesAudio={session.mode === 'assist' && !session.isDemo}
          transcriptionStatus={session.transcriptionStatus}
        />
        {session.isDemo && running && <span className="badge bg-violet-600 text-white" data-testid="demo-banner">Demo data — not a real transcript</span>}
        <div className="ml-auto max-w-xl flex-1">
          <ScreenShareNotice compact={s.ui.compact} />
        </div>
      </div>

      <div className={cx('grid min-h-0 flex-1 gap-3', !s.ui.compact && 'lg:grid-cols-2')}>
        <div className="flex min-h-[16rem] flex-col gap-3">
          {showTranscript ? (
            <LiveTranscript
              segments={session.segments}
              isDemo={session.isDemo}
              onMarkQuestion={(text, ids) => void markQuestion(text, ids)}
              emptyHint={mode === 'assist' ? 'Press Start session. The transcript appears here as people speak.' : 'Press Start practice to play the demo interview.'}
            />
          ) : (
            <section className="card flex min-h-0 flex-1 flex-col" aria-labelledby="practice-heading">
              <header className="border-b border-slate-200 px-4 py-2.5 dark:border-white/10">
                <h2 id="practice-heading" className="text-sm font-semibold">Practice questions</h2>
              </header>
              <form
                className="flex gap-2 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (customQuestion.trim().length < 3) return;
                  void markQuestion(customQuestion.trim(), [], 'practice');
                  setCustomQuestion('');
                }}
              >
                <input
                  className="input"
                  placeholder="Type any interview question…"
                  value={customQuestion}
                  onChange={(event) => setCustomQuestion(event.target.value)}
                  aria-label="Ask a practice question"
                  data-testid="practice-input"
                />
                <button type="submit" className="btn-primary" disabled={customQuestion.trim().length < 3} data-testid="practice-ask">
                  <MessageSquare className="size-4" aria-hidden /> Ask
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  title="Random question"
                  aria-label="Ask a random practice question"
                  onClick={() => {
                    const pick = practiceQuestions[Math.floor(Math.random() * practiceQuestions.length)];
                    if (pick) void markQuestion(pick.text, [], 'practice');
                  }}
                >
                  <Shuffle className="size-4" aria-hidden />
                </button>
              </form>
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3" data-testid="practice-list">
                {practiceQuestions.map((question) => (
                  <li key={question.text}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-white/5"
                      onClick={() => void markQuestion(question.text, [], 'practice')}
                    >
                      <span className="badge mt-0.5 shrink-0 bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300">
                        {QUESTION_TYPE_LABELS[question.type]}
                      </span>
                      {question.text}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <section className="flex min-h-0 flex-col gap-3 overflow-y-auto pb-2" aria-label="Questions and suggested answers" data-testid="questions">
          {session.questions.length === 0 ? (
            <div className="card flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              <MessageSquare className="size-6" aria-hidden />
              <p>Detected questions and suggested answers appear here.</p>
              <p className="text-xs">
                Tip: select transcript text and press {MOD}+Shift+Q to answer it, or hover a line and click the ? button.
              </p>
            </div>
          ) : (
            session.questions.map((question, index) => (
              <QuestionCard
                key={question.id}
                question={question}
                answers={session.answers[question.id] ?? []}
                generating={session.generating[question.id]}
                error={session.answerErrors[question.id]}
                highlighted={index === 0}
                onGenerate={(format) => generate(question.id, format)}
                onCancel={() => void api().session.cancel(question.id)}
                onFeedback={(createdAt, feedback) => void api().session.feedback(question.id, createdAt, feedback)}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
}
