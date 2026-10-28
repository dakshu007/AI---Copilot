import { Info, TriangleAlert, X } from 'lucide-react';
import type { Notice } from '../hooks/useSessionStore';
import { cx } from '../lib/format';

export function Notices({ notices, onDismiss }: { notices: Notice[]; onDismiss(id: number): void }) {
  if (notices.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {notices.map((notice) => (
        <div
          key={notice.id}
          role={notice.level === 'error' ? 'alert' : 'status'}
          className={cx(
            'pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg',
            notice.level === 'error' && 'border-red-200 bg-red-50 text-red-900 dark:border-red-400/30 dark:bg-red-950 dark:text-red-100',
            notice.level === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950 dark:text-amber-100',
            notice.level === 'info' && 'border-slate-200 bg-white text-slate-800 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100',
          )}
        >
          {notice.level === 'info' ? <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <p className="flex-1">{notice.message}</p>
          <button type="button" className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => onDismiss(notice.id)} aria-label="Dismiss">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
