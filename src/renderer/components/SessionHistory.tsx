import { Download, Search, Trash } from 'lucide-react';
import type { SessionRecord, SessionSummary } from '@shared/types';
import { FORMAT_LABELS, cx, formatDateTime, formatOffset } from '../lib/format';

export interface SessionHistoryProps {
  enabled: boolean;
  sessions: SessionSummary[];
  query: string;
  selected: SessionRecord | null;
  onQueryChange(query: string): void;
  onSelect(id: string): void;
  onDelete(id: string): void;
  onDeleteAll(): void;
  onExport(id: string, format: 'md' | 'txt'): void;
  onEnable(): void;
}

export function SessionHistory(props: SessionHistoryProps) {
  const { enabled, sessions, query, selected } = props;
  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[22rem_1fr]">
      <section className="card flex min-h-0 flex-col" aria-labelledby="history-list-heading">
        <header className="space-y-2 border-b border-slate-200 p-3 dark:border-white/10">
          <div className="flex items-center justify-between">
            <h2 id="history-list-heading" className="text-sm font-semibold">Saved sessions</h2>
            {sessions.length > 0 && (
              <button type="button" className="btn-ghost text-xs text-red-600 dark:text-red-400" onClick={props.onDeleteAll} data-testid="delete-all-history">
                Delete all
              </button>
            )}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" aria-hidden />
            <input
              className="input pl-8"
              placeholder="Search transcripts and answers"
              value={query}
              onChange={(event) => props.onQueryChange(event.target.value)}
              aria-label="Search history"
            />
          </div>
        </header>
        {!enabled && (
          <div className="m-3 rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-white/5 dark:text-slate-300">
            Session history is off. Nothing is saved after a session ends.{' '}
            <button type="button" className="font-semibold text-accent-600 underline dark:text-accent-300" onClick={props.onEnable}>
              Turn on history
            </button>
          </div>
        )}
        <ul className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="history-list">
          {sessions.length === 0 && <li className="p-4 text-center text-sm text-slate-500">No saved sessions.</li>}
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => props.onSelect(session.id)}
                className={cx(
                  'w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-white/5',
                  selected?.id === session.id && 'bg-accent-50 dark:bg-accent-500/10',
                )}
              >
                <p className="truncate text-sm font-medium">{session.title || formatDateTime(session.startedAt)}</p>
                <p className="truncate text-xs text-slate-500">
                  {session.questionCount} questions · {session.answerCount} answers{session.isDemo ? ' · demo' : ''}
                </p>
                {session.preview && <p className="mt-0.5 truncate text-xs text-slate-400">{session.preview}</p>}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card min-h-0 overflow-y-auto p-4" aria-label="Session details">
        {!selected ? (
          <p className="py-10 text-center text-sm text-slate-500">Select a session to view its transcript and answers.</p>
        ) : (
          <div className="space-y-5">
            <header className="flex flex-wrap items-start gap-2">
              <div className="flex-1">
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <p className="text-xs text-slate-500">
                  {formatDateTime(selected.startedAt)}
                  {selected.isDemo && ' · contains demo data'}
                </p>
              </div>
              <button type="button" className="btn-secondary text-xs" onClick={() => props.onExport(selected.id, 'md')}>
                <Download className="size-3.5" aria-hidden /> Markdown
              </button>
              <button type="button" className="btn-secondary text-xs" onClick={() => props.onExport(selected.id, 'txt')}>
                <Download className="size-3.5" aria-hidden /> Text
              </button>
              <button type="button" className="btn-ghost text-xs text-red-600 dark:text-red-400" onClick={() => props.onDelete(selected.id)} data-testid="delete-session">
                <Trash className="size-3.5" aria-hidden /> Delete
              </button>
            </header>
            {selected.summary && (
              <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-white/10" data-testid="history-summary">
                <h3 className="label">Meeting summary</h3>
                <p>{selected.summary.summary}</p>
                {selected.summary.decisions.length > 0 && (
                  <ul className="list-disc pl-5">
                    {selected.summary.decisions.map((decision) => (
                      <li key={decision}>Decision: {decision}</li>
                    ))}
                  </ul>
                )}
                {selected.summary.actionItems.length > 0 && (
                  <ul className="space-y-0.5">
                    {selected.summary.actionItems.map((item) => (
                      <li key={item.task}>
                        ☐ {item.task}
                        {item.owner ? ` — ${item.owner}` : ''}
                        {item.due ? ` (due ${item.due})` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {selected.insights?.hasSpeakerSeparation && (
              <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="history-insights">
                You spoke {Math.round(selected.insights.yourShare * 100)}% of the time
                {selected.insights.wordsPerMinute ? ` at ${selected.insights.wordsPerMinute} wpm` : ''}, with {selected.insights.fillerCount} filler
                word{selected.insights.fillerCount === 1 ? '' : 's'} and {selected.insights.questionsAsked} question
                {selected.insights.questionsAsked === 1 ? '' : 's'} asked.
              </p>
            )}
            <div>
              <h3 className="label">Questions &amp; answers</h3>
              {selected.questions.length === 0 && <p className="text-sm text-slate-500">No questions.</p>}
              <div className="space-y-3">
                {selected.questions.map((question) => (
                  <div key={question.id} className="rounded-lg border border-slate-200 p-3 dark:border-white/10">
                    <p className="font-medium">{question.text}</p>
                    {selected.answers
                      .filter((answer) => answer.questionId === question.id)
                      .map((answer) => (
                        <p key={answer.createdAt} className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                          <span className="badge mr-1 bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300">{FORMAT_LABELS[answer.format]}</span>
                          {answer.answer}
                        </p>
                      ))}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="label">Transcript</h3>
              <div className="space-y-1.5 text-sm">
                {selected.segments.map((segment) => (
                  <p key={segment.id}>
                    <span className="mr-2 font-mono text-[11px] text-slate-400">{formatOffset(segment.startMs)}</span>
                    <span className="mr-1.5 text-xs font-semibold">{segment.speaker}</span>
                    {segment.text}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
