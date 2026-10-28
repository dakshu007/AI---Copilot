import { useState } from 'react';
import { Plus, X } from 'lucide-react';

export interface ListEditorProps {
  label: string;
  items: string[];
  placeholder?: string;
  onChange(items: string[]): void;
  multiline?: boolean;
}

/** Editable list of short facts (skills, achievements, highlights…). */
export function ListEditor({ label, items, placeholder, onChange, multiline }: ListEditorProps) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...items, value]);
    setDraft('');
  };
  const id = `list-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <fieldset className="space-y-1.5">
      <legend className="label">{label}</legend>
      <ul className="space-y-1.5">
        {items.map((item, index) => (
          <li key={`${index}-${item.slice(0, 10)}`} className="flex items-start gap-1.5">
            {multiline ? (
              <textarea
                className="input min-h-[2.5rem] py-1.5"
                rows={Math.min(4, Math.ceil(item.length / 80))}
                value={item}
                aria-label={`${label} item ${index + 1}`}
                onChange={(event) => onChange(items.map((v, i) => (i === index ? event.target.value : v)))}
              />
            ) : (
              <input
                className="input py-1.5"
                value={item}
                aria-label={`${label} item ${index + 1}`}
                onChange={(event) => onChange(items.map((v, i) => (i === index ? event.target.value : v)))}
              />
            )}
            <button
              type="button"
              className="btn-ghost mt-0.5 px-1.5"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              aria-label={`Remove ${item || 'item'}`}
            >
              <X className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-1.5">
        <input
          id={id}
          className="input py-1.5"
          value={draft}
          placeholder={placeholder ?? 'Add…'}
          aria-label={`Add to ${label}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn-secondary" onClick={add} disabled={!draft.trim()} aria-label={`Add item to ${label}`}>
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
    </fieldset>
  );
}
