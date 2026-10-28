import { useEffect, useState } from 'react';
import { Briefcase, Trash, Wand } from 'lucide-react';
import type { JobContext } from '@shared/types';
import { ListEditor } from './ListEditor';

export const EMPTY_JOB: JobContext = { title: '', company: '', text: '', requirements: [], skills: [], updatedAt: 0 };

export interface JobDescriptionEditorProps {
  job: JobContext | null;
  onAnalyze(text: string): Promise<JobContext>;
  onSave(job: JobContext): Promise<void>;
  onDelete(): Promise<void>;
}

export function JobDescriptionEditor({ job, onAnalyze, onSave, onDelete }: JobDescriptionEditorProps) {
  const [draft, setDraft] = useState<JobContext>(job ?? EMPTY_JOB);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(job ?? EMPTY_JOB);
  }, [job]);

  const update = (patch: Partial<JobContext>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
  };

  const analyze = async () => {
    setBusy(true);
    setError('');
    try {
      const analyzed = await onAnalyze(draft.text);
      setDraft({ ...analyzed, title: draft.title || analyzed.title, company: draft.company || analyzed.company });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="job-heading">
      <header>
        <h2 id="job-heading" className="flex items-center gap-2 text-lg font-semibold">
          <Briefcase className="size-5" aria-hidden /> Job description
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Optional. Helps tailor answers to what the role asks for.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="label">Role title</span>
          <input className="input" value={draft.title} onChange={(e) => update({ title: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Company</span>
          <input className="input" value={draft.company} onChange={(e) => update({ company: e.target.value })} />
        </label>
      </div>
      <label className="block">
        <span className="label">Job description text</span>
        <textarea
          className="input min-h-40 text-sm"
          value={draft.text}
          onChange={(e) => update({ text: e.target.value })}
          placeholder="Paste the job description…"
          data-testid="job-text"
        />
      </label>
      <button type="button" className="btn-secondary" disabled={busy || draft.text.trim().length < 20} onClick={analyze} data-testid="analyze-job">
        <Wand className="size-4" aria-hidden /> Derive requirements
      </button>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <ListEditor label="Requirements" items={draft.requirements} multiline onChange={(requirements) => update({ requirements })} />
        <ListEditor label="Skills sought" items={draft.skills} onChange={(skills) => update({ skills })} />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(draft);
              setSaved(true);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
          data-testid="save-job"
        >
          Save job description
        </button>
        {saved && <span className="text-sm text-emerald-600" role="status">Saved</span>}
        {job && (
          <button
            type="button"
            className="btn-ghost ml-auto text-red-600 dark:text-red-400"
            onClick={async () => {
              await onDelete();
              setDraft(EMPTY_JOB);
            }}
          >
            <Trash className="size-4" aria-hidden /> Remove
          </button>
        )}
      </div>
    </section>
  );
}
