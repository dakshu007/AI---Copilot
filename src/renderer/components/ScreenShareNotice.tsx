import { Monitor } from 'lucide-react';

/** Transparency reminder shown on the session page. */
export function ScreenShareNotice({ compact = false, meeting = false }: { compact?: boolean; meeting?: boolean }) {
  return (
    <div className="flex gap-2 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300" role="note">
      <Monitor className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        {compact
          ? 'Visible when you share your screen or this window.'
          : meeting
            ? 'This is a normal window: if you share your entire screen, participants can see it. In Teams, share a single window (Share → Window) or keep Copilot on a second display.'
            : 'Interview Copilot is a normal window: if you share your entire screen or this window in Teams, Zoom or Meet, other participants can see it. Use live assistance only where the interview organizer permits it.'}
      </p>
    </div>
  );
}
