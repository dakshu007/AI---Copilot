import { useMemo } from 'react';
import { CircleCheck, Lightbulb, MessageCircle } from 'lucide-react';
import { computeInsights, insightTips } from '@shared/core/communicationInsights';
import type { TranscriptSegment } from '@shared/types';
import { cx } from '../lib/format';

function seconds(ms: number): string {
  const total = Math.round(ms / 1_000);
  return total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`;
}

/**
 * Private, local speaking metrics for the user. Computed in the window from the transcript;
 * nothing is sent anywhere.
 */
export function CommunicationInsights({ segments }: { segments: TranscriptSegment[] }) {
  const insights = useMemo(() => computeInsights(segments), [segments]);
  const tips = useMemo(() => insightTips(insights), [insights]);
  const share = Math.round(insights.yourShare * 100);

  return (
    <section className="card space-y-3 p-4" aria-labelledby="insights-heading" data-testid="insights">
      <header className="flex items-center justify-between">
        <h2 id="insights-heading" className="flex items-center gap-1.5 text-sm font-semibold">
          <MessageCircle className="size-4" aria-hidden /> Your communication
        </h2>
        <span className="text-[11px] text-slate-400">Private · computed on this Mac</span>
      </header>

      {!insights.hasSpeakerSeparation ? (
        <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="insights-empty">
          Insights appear once both you and others have spoken. Use <strong>Microphone + system audio</strong> so your voice is told apart from your
          teammates'.
        </p>
      ) : (
        <>
          <div>
            <div className="mb-1 flex justify-between text-xs text-slate-600 dark:text-slate-300">
              <span>You {share}%</span>
              <span>Others {100 - share}%</span>
            </div>
            <div
              className="flex h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10"
              role="meter"
              aria-label="Your share of talk time"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={share}
            >
              <div className="bg-emerald-500" style={{ width: `${share}%` }} />
              <div className="bg-accent-400 flex-1" />
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <Stat label="Talk time" value={seconds(insights.yourTalkMs)} />
            <Stat label="Pace" value={insights.wordsPerMinute ? `${insights.wordsPerMinute} wpm` : '—'} />
            <Stat
              label="Filler words"
              value={String(insights.fillerCount)}
              detail={insights.topFillers.length ? insights.topFillers.map((f) => `${f.word} ×${f.count}`).join(', ') : undefined}
              testId="filler-count"
            />
            <Stat label="Questions asked" value={String(insights.questionsAsked)} />
          </dl>
          {tips.length > 0 && (
            <ul className="space-y-1.5" aria-label="Coaching tips">
              {tips.map((tip) => (
                <li key={tip.message} className={cx('flex gap-2 text-sm', tip.level === 'good' ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-300')}>
                  {tip.level === 'good' ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />}
                  {tip.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, detail, testId }: { label: string; value: string; detail?: string; testId?: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="font-semibold tabular-nums" data-testid={testId}>
        {value}
      </dd>
      {detail && <dd className="text-[11px] text-slate-500">{detail}</dd>}
    </div>
  );
}
