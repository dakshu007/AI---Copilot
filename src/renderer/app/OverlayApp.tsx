import { useEffect } from 'react';
import { Monitor } from 'lucide-react';
import { CaptureStatusIndicator } from '../components/CaptureStatusIndicator';
import { SuggestedAnswer } from '../components/SuggestedAnswer';
import { QUESTION_TYPE_LABELS } from '../lib/format';
import { useCopilot } from './CopilotProvider';

/**
 * Compact, read-only answer window. It mirrors the dashboard's suggested answers and recent
 * transcript so the user can keep it on a second monitor or beside their meeting app. It does no
 * audio capture of its own — the main dashboard owns the session.
 *
 * This is an ordinary window, not a capture-evasion overlay. If the whole desktop (or this
 * window) is shared, it is visible like anything else.
 */
export function OverlayApp() {
  const { session } = useCopilot();

  // Follow the system/dark preference without the dashboard's theme controls.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  const usesAudio = session.mode !== 'practice' && session.mode !== null && !session.isDemo;
  const latestSegments = session.segments.filter((s) => s.status === 'final' && s.text.trim()).slice(-4);

  return (
    <div className="flex h-full flex-col bg-slate-50 text-slate-900 dark:bg-[#0b0d12] dark:text-slate-100">
      <header className="drag-region flex items-center justify-between gap-2 border-b border-slate-200 px-3 pt-7 pb-2 dark:border-white/10">
        <span className="text-xs font-semibold">Answers</span>
        <CaptureStatusIndicator
          state={session.state}
          isDemo={session.isDemo}
          usesAudio={usesAudio}
          transcriptionStatus={session.transcriptionStatus}
        />
      </header>

      <main className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {session.questions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-slate-500 dark:text-slate-400">
            <Monitor className="size-5" aria-hidden />
            <p>Suggested answers will appear here while a session runs in the dashboard.</p>
            {latestSegments.length > 0 && (
              <p className="mt-2 text-xs text-slate-400">
                Latest: {latestSegments[latestSegments.length - 1]!.text}
              </p>
            )}
          </div>
        ) : (
          session.questions.map((question) => {
            const answers = session.answers[question.id] ?? [];
            const latest = answers[answers.length - 1];
            const generating = session.generating[question.id];
            const error = session.answerErrors[question.id];
            return (
              <article key={question.id} className="card space-y-2 p-3" data-testid="overlay-question">
                <div className="flex items-center gap-1.5">
                  <span className="badge bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300">
                    {QUESTION_TYPE_LABELS[question.type]}
                  </span>
                </div>
                <h2 className="text-sm leading-snug font-semibold" data-testid="overlay-question-text">
                  {question.text}
                </h2>
                {generating && <p className="text-xs text-accent-600 dark:text-accent-300">Generating…</p>}
                {error && !generating && <p className="text-xs text-red-600 dark:text-red-400">{error.message}</p>}
                {latest && <SuggestedAnswer suggestion={latest} />}
              </article>
            );
          })
        )}
      </main>

      <footer className="border-t border-slate-200 px-3 py-1.5 text-[10px] text-slate-400 dark:border-white/10">
        A normal window — visible if you share your whole screen. Share a single window instead, or keep this on another display.
      </footer>
    </div>
  );
}
