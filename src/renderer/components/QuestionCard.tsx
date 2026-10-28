import { LoaderCircle, RefreshCw, Sparkles, TriangleAlert, X } from 'lucide-react';
import type { AnswerFormat, AnswerSuggestion, DetectedQuestion } from '@shared/types';
import { FORMAT_LABELS, QUESTION_TYPE_LABELS, cx } from '../lib/format';
import { SuggestedAnswer } from './SuggestedAnswer';

export interface QuestionCardProps {
  question: DetectedQuestion;
  answers: AnswerSuggestion[];
  generating?: AnswerFormat;
  error?: { message: string; retryable: boolean };
  highlighted?: boolean;
  onGenerate(format?: AnswerFormat): void;
  onCancel(): void;
  onFeedback(createdAt: number, feedback: 'useful' | 'not-useful'): void;
}

const VARIANTS: Array<{ format: AnswerFormat; label: string }> = [
  { format: 'concise', label: 'Simpler' },
  { format: 'technical', label: 'More technical' },
  { format: 'star', label: 'STAR' },
  { format: 'conversational', label: 'Conversational' },
];

export function QuestionCard({ question, answers, generating, error, highlighted, onGenerate, onCancel, onFeedback }: QuestionCardProps) {
  const latest = answers[answers.length - 1];
  return (
    <article
      className={cx('card space-y-3 p-4', highlighted && 'ring-2 ring-accent-500/40')}
      data-testid="question-card"
      aria-label={`Question: ${question.text}`}
    >
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="badge bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-300">{QUESTION_TYPE_LABELS[question.type]}</span>
          {question.source !== 'detected' && (
            <span className="badge bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400">{question.source}</span>
          )}
          {question.source === 'detected' && (
            <span className="text-[11px] text-slate-400">confidence {Math.round(question.confidence * 100)}%</span>
          )}
        </div>
        <h3 className="text-base leading-snug font-semibold" data-testid="question-text">
          {question.text}
        </h3>
      </header>

      {generating && (
        <div className="flex items-center gap-2 rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-700 dark:bg-accent-500/10 dark:text-accent-200" role="status" data-testid="generating">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Generating {FORMAT_LABELS[generating].toLowerCase()} answer…
          <button type="button" className="btn-ghost ml-auto px-2 py-0.5 text-xs" onClick={onCancel} data-testid="cancel-answer">
            <X className="size-3.5" aria-hidden /> Cancel
          </button>
        </div>
      )}

      {error && !generating && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200" role="alert">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="flex-1">{error.message}</span>
          {error.retryable && (
            <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => onGenerate()}>
              <RefreshCw className="size-3.5" aria-hidden /> Retry
            </button>
          )}
        </div>
      )}

      {latest && (
        <SuggestedAnswer
          key={latest.createdAt}
          suggestion={latest}
          onFeedback={(feedback) => onFeedback(latest.createdAt, feedback)}
        />
      )}

      {!latest && !generating && !error && (
        <button type="button" className="btn-primary" onClick={() => onGenerate()} data-testid="generate-answer">
          <Sparkles className="size-4" aria-hidden /> Suggest an answer
        </button>
      )}

      {(latest || error) && (
        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-3 dark:border-white/5" role="group" aria-label="Regenerate answer">
          {VARIANTS.map((variant) => (
            <button
              key={variant.format}
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              disabled={Boolean(generating)}
              onClick={() => onGenerate(variant.format)}
            >
              {variant.label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
