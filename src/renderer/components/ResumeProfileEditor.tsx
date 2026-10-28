import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ChevronDown, FileText, Plus, ShieldCheck, Trash, TriangleAlert, Upload, X } from 'lucide-react';
import type { CandidateProfile, Experience, Project, ResumeImportResult } from '@shared/types';
import { cx } from '../lib/format';
import { ListEditor } from './ListEditor';

export const EMPTY_PROFILE: CandidateProfile = {
  name: '',
  headline: '',
  summary: '',
  skills: [],
  experience: [],
  projects: [],
  achievements: [],
  education: [],
  additionalFacts: [],
  resumeText: '',
  resumeFileName: '',
  verified: false,
  updatedAt: 0,
};

export interface ResumeProfileEditorProps {
  profile: CandidateProfile | null;
  onImportFile(): Promise<ResumeImportResult | null>;
  onImportBytes(fileName: string, bytes: Uint8Array): Promise<ResumeImportResult>;
  onExtractText(text: string): Promise<ResumeImportResult>;
  onSave(profile: CandidateProfile): Promise<void>;
  onDelete(): Promise<void>;
}

export function ResumeProfileEditor({ profile, onImportFile, onImportBytes, onExtractText, onSave, onDelete }: ResumeProfileEditorProps) {
  const [draft, setDraft] = useState<CandidateProfile>(profile ?? EMPTY_PROFILE);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [dirty, setDirtyState] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dirtyRef = useRef(false);
  const setDirty = (value: boolean) => {
    dirtyRef.current = value;
    setDirtyState(value);
  };

  // Follow the saved profile, but never overwrite unsaved edits.
  useEffect(() => {
    if (!dirtyRef.current) setDraft(profile ?? EMPTY_PROFILE);
  }, [profile]);

  const update = (patch: Partial<CandidateProfile>) => {
    setDraft((current) => ({ ...current, ...patch, verified: false }));
    setDirty(true);
  };

  const run = async (task: () => Promise<ResumeImportResult | null>) => {
    setBusy(true);
    setError('');
    try {
      const result = await task();
      if (result) {
        setDraft({
          ...result.profile,
          resumeText: result.profile.resumeText || result.text,
          // Keep facts the user typed by hand; they are not part of the resume.
          additionalFacts: draft.additionalFacts,
        });
        setWarnings(result.warnings);
        setDirty(true);
        setShowRaw(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = async (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    await run(async () => onImportBytes(file.name, new Uint8Array(await file.arrayBuffer())));
  };

  const save = async (verified: boolean) => {
    setBusy(true);
    setError('');
    try {
      await onSave({ ...draft, verified });
      setDraft((current) => ({ ...current, verified }));
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const hasContent = Boolean(draft.resumeText || draft.skills.length || draft.experience.length || draft.summary);

  return (
    <section className="space-y-5" aria-labelledby="profile-heading">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="profile-heading" className="text-lg font-semibold">Resume profile</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Extracted locally on this Mac. Only facts relevant to a question are sent to your AI provider, and only after you consent.
          </p>
        </div>
        <span
          className={cx(
            'badge',
            draft.verified && !dirty
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200'
              : 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
          )}
          data-testid="profile-status"
        >
          {draft.verified && !dirty ? 'Confirmed' : 'Not confirmed'}
        </span>
      </header>

      <div
        className={cx(
          'card flex flex-col items-center gap-3 border-dashed p-6 text-center transition-colors',
          dragging && 'border-accent-500 bg-accent-50 dark:bg-accent-500/10',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <Upload className="size-6 text-slate-400" aria-hidden />
        <p className="text-sm text-slate-600 dark:text-slate-300">Drop a PDF, DOCX or TXT resume here (max 10 MB), or</p>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => run(onImportFile)} data-testid="import-resume">
          <FileText className="size-4" aria-hidden /> Choose file…
        </button>
        <details className="w-full max-w-xl text-left">
          <summary className="cursor-pointer text-center text-sm text-accent-600 dark:text-accent-300">Or paste resume text</summary>
          <textarea
            className="input mt-2 min-h-32 font-mono text-xs"
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder="Paste the text of your resume…"
            aria-label="Paste resume text"
            data-testid="paste-resume"
          />
          <button
            type="button"
            className="btn-secondary mt-2"
            disabled={busy || pasted.trim().length < 30}
            onClick={() => run(() => onExtractText(pasted))}
            data-testid="extract-resume"
          >
            Extract facts
          </button>
        </details>
      </div>

      {error && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200" role="alert">
          <TriangleAlert className="size-4" aria-hidden /> {error}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100" role="note">
          {warnings.map((warning) => (
            <li key={warning}>⚠︎ {warning}</li>
          ))}
        </ul>
      )}

      {hasContent && (
        <>
          {draft.resumeText && (
            <div className="card">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold"
                aria-expanded={showRaw}
                onClick={() => setShowRaw((v) => !v)}
              >
                Extracted text preview {draft.resumeFileName && <span className="font-normal text-slate-500">({draft.resumeFileName})</span>}
                <ChevronDown className={cx('size-4 transition-transform', showRaw && 'rotate-180')} aria-hidden />
              </button>
              {showRaw && (
                <textarea
                  className="input m-0 min-h-48 rounded-none rounded-b-xl border-x-0 border-b-0 font-mono text-xs"
                  value={draft.resumeText}
                  onChange={(event) => update({ resumeText: event.target.value })}
                  aria-label="Extracted resume text"
                />
              )}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="label">Name</span>
              <input className="input" value={draft.name} onChange={(event) => update({ name: event.target.value })} />
            </label>
            <label className="block">
              <span className="label">Headline</span>
              <input
                className="input"
                value={draft.headline}
                placeholder="e.g. Backend engineer, 6 years"
                onChange={(event) => update({ headline: event.target.value })}
              />
            </label>
          </div>
          <label className="block">
            <span className="label">Summary</span>
            <textarea className="input min-h-20" value={draft.summary} onChange={(event) => update({ summary: event.target.value })} />
          </label>

          <ListEditor label="Skills" items={draft.skills} placeholder="Add a skill" onChange={(skills) => update({ skills })} />

          <ExperienceEditor items={draft.experience} onChange={(experience) => update({ experience })} />
          <ProjectEditor items={draft.projects} onChange={(projects) => update({ projects })} />

          <div className="grid gap-4 md:grid-cols-2">
            <ListEditor label="Achievements" items={draft.achievements} multiline onChange={(achievements) => update({ achievements })} />
            <ListEditor label="Education" items={draft.education} onChange={(education) => update({ education })} />
          </div>
          <ListEditor
            label="Additional facts (only true statements)"
            items={draft.additionalFacts}
            multiline
            placeholder="e.g. Led on-call rotation for 8 engineers in 2023"
            onChange={(additionalFacts) => update({ additionalFacts })}
          />
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4 dark:border-white/10">
        <button type="button" className="btn-primary" disabled={busy || !hasContent} onClick={() => save(true)} data-testid="confirm-profile">
          <ShieldCheck className="size-4" aria-hidden /> Confirm facts &amp; save
        </button>
        <button type="button" className="btn-secondary" disabled={busy || !hasContent} onClick={() => save(false)}>
          Save draft
        </button>
        {profile && (
          <button
            type="button"
            className="btn-ghost ml-auto text-red-600 dark:text-red-400"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('Delete your resume profile from this Mac?')) return;
              await onDelete();
              setDraft(EMPTY_PROFILE);
              setWarnings([]);
              setDirty(false);
            }}
          >
            <Trash className="size-4" aria-hidden /> Delete profile
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Answers only use confirmed facts. The copilot is instructed never to invent experience, and flags anything it could not ground in these facts.
      </p>
    </section>
  );
}

function ExperienceEditor({ items, onChange }: { items: Experience[]; onChange(items: Experience[]): void }) {
  const patch = (index: number, value: Partial<Experience>) => onChange(items.map((item, i) => (i === index ? { ...item, ...value } : item)));
  return (
    <fieldset className="space-y-3">
      <legend className="label">Experience</legend>
      {items.map((item, index) => (
        <div key={index} className="card space-y-2 p-3">
          <div className="grid gap-2 md:grid-cols-[2fr_2fr_1.3fr_auto]">
            <input className="input" aria-label={`Role ${index + 1} title`} placeholder="Title" value={item.title} onChange={(e) => patch(index, { title: e.target.value })} />
            <input className="input" aria-label={`Role ${index + 1} company`} placeholder="Company" value={item.company} onChange={(e) => patch(index, { company: e.target.value })} />
            <input className="input" aria-label={`Role ${index + 1} period`} placeholder="Period" value={item.period} onChange={(e) => patch(index, { period: e.target.value })} />
            <button type="button" className="btn-ghost" aria-label={`Remove role ${item.title}`} onClick={() => onChange(items.filter((_, i) => i !== index))}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <ListEditor label={`Highlights for ${item.title || `role ${index + 1}`}`} items={item.highlights} multiline onChange={(highlights) => patch(index, { highlights })} />
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={() => onChange([...items, { title: '', company: '', period: '', highlights: [] }])}>
        <Plus className="size-4" aria-hidden /> Add role
      </button>
    </fieldset>
  );
}

function ProjectEditor({ items, onChange }: { items: Project[]; onChange(items: Project[]): void }) {
  const patch = (index: number, value: Partial<Project>) => onChange(items.map((item, i) => (i === index ? { ...item, ...value } : item)));
  return (
    <fieldset className="space-y-3">
      <legend className="label">Projects</legend>
      {items.map((item, index) => (
        <div key={index} className="card space-y-2 p-3">
          <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
            <input className="input" aria-label={`Project ${index + 1} name`} placeholder="Name" value={item.name} onChange={(e) => patch(index, { name: e.target.value })} />
            <input className="input" aria-label={`Project ${index + 1} description`} placeholder="Description" value={item.description} onChange={(e) => patch(index, { description: e.target.value })} />
            <button type="button" className="btn-ghost" aria-label={`Remove project ${item.name}`} onClick={() => onChange(items.filter((_, i) => i !== index))}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <ListEditor label={`Highlights for ${item.name || `project ${index + 1}`}`} items={item.highlights} multiline onChange={(highlights) => patch(index, { highlights })} />
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={() => onChange([...items, { name: '', description: '', highlights: [] }])}>
        <Plus className="size-4" aria-hidden /> Add project
      </button>
    </fieldset>
  );
}
