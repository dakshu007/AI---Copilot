import { useState } from 'react';
import { Check, ClipboardList, Copy, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { MeetingSummary } from '@shared/types';

export interface MeetingSummaryCardProps {
  summary?: MeetingSummary;
  summarizing: boolean;
  error?: string;
  canSummarize: boolean;
  onSummarize(): void;
}

export function summaryToMarkdown(summary: MeetingSummary): string {
  const lines = ['## Meeting summary', '', summary.summary, ''];
  if (summary.decisions.length) lines.push('**Decisions**', ...summary.decisions.map((d) => `- ${d}`), '');
  if (summary.actionItems.length) {
    lines.push('**Action items**', ...summary.actionItems.map((a) => `- [ ] ${a.task}${a.owner ? ` — ${a.owner}` : ''}${a.due ? ` (due ${a.due})` : ''}`), '');
  }
  if (summary.openQuestions.length) lines.push('**Open questions**', ...summary.openQuestions.map((q) => `- ${q}`), '');
  return lines.join('\n').trim();
}

export function MeetingSummaryCard({ summary, summarizing, error, canSummarize, onSummarize }: MeetingSummaryCardProps) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="card space-y-3 p-4" aria-labelledby="summary-heading" data-testid="meeting-summary">
      <header className="flex flex-wrap items-center gap-2">
        <h2 id="summary-heading" className="flex items-center gap-1.5 text-sm font-semibold">
          <ClipboardList className="size-4" aria-hidden /> Meeting summary
        </h2>
        {summary?.isDemo && <span className="badge bg-violet-600 text-white">Offline summary</span>}
        <div className="ml-auto flex gap-1.5">
          {summary && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={async () => {
                await navigator.clipboard.writeText(summaryToMarkdown(summary));
                setCopied(true);
                setTimeout(() => setCopied(false), 1_500);
              }}
            >
              {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
          <button type="button" className="btn-secondary text-xs" disabled={!canSummarize || summarizing} onClick={onSummarize} data-testid="summarize">
            {summarizing && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
            {summary ? 'Update summary' : 'Summarize meeting'}
          </button>
        </div>
      </header>

      {error && (
        <p className="flex gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200" role="alert">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {!summary && !error && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Get the key points, decisions and action items to share with your team, during or after the meeting.
        </p>
      )}

      {summary && (
        <div className="space-y-3 text-sm" data-testid="summary-body">
          <p className="leading-relaxed">{summary.summary}</p>
          <SummaryList title="Decisions" items={summary.decisions} />
          {summary.actionItems.length > 0 && (
            <div>
              <h3 className="label">Action items</h3>
              <ul className="space-y-1" data-testid="action-items">
                {summary.actionItems.map((item) => (
                  <li key={item.task} className="flex gap-2">
                    <span aria-hidden>☐</span>
                    <span>
                      {item.task}
                      {(item.owner || item.due) && (
                        <span className="text-slate-500">
                          {' '}
                          — {[item.owner, item.due && `due ${item.due}`].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <SummaryList title="Open questions" items={summary.openQuestions} />
          <p className="text-[11px] text-slate-400">{summary.provider} · verify before sending</p>
        </div>
      )}
    </section>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="label">{title}</h3>
      <ul className="list-disc space-y-0.5 pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
