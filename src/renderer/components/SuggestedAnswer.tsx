import { useState } from 'react';
import { Check, ChevronDown, Copy, ThumbsDown, ThumbsUp, TriangleAlert } from 'lucide-react';
import type { AnswerSuggestion } from '@shared/types';
import { FORMAT_LABELS, cx } from '../lib/format';

export interface SuggestedAnswerProps {
  suggestion: AnswerSuggestion;
  onFeedback?(feedback: 'useful' | 'not-useful'): void;
  onCopy?(text: string): Promise<void> | void;
}

export function SuggestedAnswer({ suggestion, onFeedback, onCopy }: SuggestedAnswerProps) {
  const [copied, setCopied] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [feedback, setFeedback] = useState(suggestion.feedback);

  const copy = async () => {
    const text = suggestion.answer;
    try {
      if (onCopy) await onCopy(text);
      else await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  const rate = (value: 'useful' | 'not-useful') => {
    setFeedback(value);
    onFeedback?.(value);
  };

  return (
    <article className="space-y-3" data-testid="suggested-answer" aria-label="Suggested answer">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="badge bg-accent-100 text-accent-700 dark:bg-accent-500/20 dark:text-accent-200">
          {FORMAT_LABELS[suggestion.format]}
        </span>
        {suggestion.isDemo && (
          <span className="badge bg-violet-600 text-white" title="Generated offline from your profile without an AI provider">
            Demo answer
          </span>
        )}
        {suggestion.insufficientEvidence && (
          <span className="badge bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">Not enough resume detail</span>
        )}
        <span className="ml-auto text-[11px] text-slate-400">{suggestion.provider}</span>
      </div>

      <p className="text-[15px] leading-relaxed whitespace-pre-line text-slate-900 dark:text-slate-50" data-testid="answer-text">
        {suggestion.answer}
      </p>

      {suggestion.generalExplanation && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm dark:border-sky-400/20 dark:bg-sky-500/10">
          <p className="mb-1 text-xs font-semibold text-sky-800 uppercase dark:text-sky-200">General knowledge — not your experience</p>
          <p className="leading-relaxed text-slate-800 dark:text-slate-200">{suggestion.generalExplanation}</p>
        </div>
      )}

      {suggestion.unsupportedClaims.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-400/30 dark:bg-amber-500/10" role="note">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-200">Not backed by your profile — verify before saying:</p>
            <ul className="mt-1 list-disc pl-4 text-amber-900 dark:text-amber-100">
              {suggestion.unsupportedClaims.map((claim) => (
                <li key={claim}>{claim}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {suggestion.followUpQuestion && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <span className="font-semibold">Likely follow-up:</span> {suggestion.followUpQuestion}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className="btn-secondary text-xs" onClick={copy} data-testid="copy-answer">
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          className={cx('btn-ghost text-xs', feedback === 'useful' && 'text-emerald-600 dark:text-emerald-400')}
          onClick={() => rate('useful')}
          aria-pressed={feedback === 'useful'}
          aria-label="Mark answer as useful"
        >
          <ThumbsUp className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          className={cx('btn-ghost text-xs', feedback === 'not-useful' && 'text-red-600 dark:text-red-400')}
          onClick={() => rate('not-useful')}
          aria-pressed={feedback === 'not-useful'}
          aria-label="Mark answer as not useful"
        >
          <ThumbsDown className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          className="btn-ghost ml-auto text-xs"
          onClick={() => setShowWhy((v) => !v)}
          aria-expanded={showWhy}
          data-testid="why-answer"
        >
          Why this answer?
          <ChevronDown className={cx('size-3.5 transition-transform', showWhy && 'rotate-180')} aria-hidden />
        </button>
      </div>

      {showWhy && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm dark:bg-white/5" data-testid="why-panel">
          <p className="text-slate-700 dark:text-slate-300">{suggestion.whyThisAnswer || 'No explanation was provided.'}</p>
          {suggestion.evidenceUsed.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase">Evidence from your profile</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-700 dark:text-slate-300">
                {suggestion.evidenceUsed.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-slate-500">No profile facts were used.</p>
          )}
        </div>
      )}
    </article>
  );
}
