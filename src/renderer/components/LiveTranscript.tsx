import { useEffect, useRef, useState } from 'react';
import { CircleQuestionMark } from 'lucide-react';
import type { TranscriptSegment } from '@shared/types';
import { cx, formatOffset } from '../lib/format';

export interface LiveTranscriptProps {
  segments: TranscriptSegment[];
  isDemo: boolean;
  onMarkQuestion(text: string, segmentIds: string[]): void;
  emptyHint?: string;
}

const ROLE_STYLES: Record<string, string> = {
  interviewer: 'text-accent-700 dark:text-accent-300',
  candidate: 'text-emerald-700 dark:text-emerald-300',
  unknown: 'text-slate-600 dark:text-slate-300',
};

/** Streaming transcript with partial/final states and "mark as question" actions. */
export function LiveTranscript({ segments, isDemo, onMarkQuestion, emptyHint }: LiveTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [selection, setSelection] = useState('');
  const visible = segments.filter((s) => s.status === 'partial' || s.text.trim());

  useEffect(() => {
    const element = scrollRef.current;
    if (element && stickToBottom) element.scrollTop = element.scrollHeight;
  }, [visible.length, segments, stickToBottom]);

  useEffect(() => {
    const onSelectionChange = () => {
      const selected = window.getSelection();
      const text = selected?.toString().trim() ?? '';
      const inside = selected?.anchorNode && scrollRef.current?.contains(selected.anchorNode);
      setSelection(inside && text.length >= 3 ? text : '');
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  return (
    <section className="card flex min-h-0 flex-1 flex-col" aria-labelledby="transcript-heading">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-white/10">
        <h2 id="transcript-heading" className="text-sm font-semibold">
          Live transcript {isDemo && <span className="badge ml-1 bg-violet-600 text-white">Demo</span>}
        </h2>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={!selection}
          onClick={() => {
            onMarkQuestion(selection, []);
            window.getSelection()?.removeAllRanges();
          }}
          data-testid="mark-selection"
          title="Select transcript text, then mark it as a question"
        >
          <CircleQuestionMark className="size-3.5" aria-hidden /> Mark selection as question
        </button>
      </header>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3"
        onScroll={(event) => {
          const element = event.currentTarget;
          setStickToBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 40);
        }}
        aria-live="polite"
        aria-relevant="additions"
        data-testid="transcript"
      >
        {visible.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            {emptyHint ?? 'The transcript appears here once a session starts.'}
          </p>
        )}
        {visible.map((segment) => (
          <div key={segment.id} className="group flex gap-3 text-sm leading-relaxed" data-status={segment.status}>
            <span className="w-11 shrink-0 pt-0.5 font-mono text-[11px] text-slate-400 tabular-nums">{formatOffset(segment.startMs)}</span>
            <div className="min-w-0 flex-1">
              <span className={cx('mr-1.5 text-xs font-semibold', ROLE_STYLES[segment.role ?? 'unknown'])}>
                {segment.speaker ?? 'Speaker'}
              </span>
              {segment.status === 'partial' && !segment.text ? (
                <span className="inline-flex gap-0.5 align-middle" aria-label="Transcribing">
                  <span className="size-1 animate-bounce rounded-full bg-slate-400" />
                  <span className="size-1 animate-bounce rounded-full bg-slate-400 [animation-delay:120ms]" />
                  <span className="size-1 animate-bounce rounded-full bg-slate-400 [animation-delay:240ms]" />
                </span>
              ) : (
                <span className={cx(segment.status === 'partial' && 'text-slate-500 italic dark:text-slate-400')}>{segment.text}</span>
              )}
            </div>
            {segment.status === 'final' && segment.text.trim() && (
              <button
                type="button"
                className="btn-ghost h-6 shrink-0 px-1.5 text-xs opacity-0 group-hover:opacity-100 focus:opacity-100"
                onClick={() => onMarkQuestion(segment.text, [segment.id])}
                aria-label={`Mark as question: ${segment.text}`}
                title="Answer this as a question"
              >
                <CircleQuestionMark className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
