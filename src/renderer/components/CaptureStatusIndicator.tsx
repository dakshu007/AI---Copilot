import { Mic, MicOff, Pause, TriangleAlert, LoaderCircle } from 'lucide-react';
import type { SessionState, TranscriptionStatus } from '@shared/types';
import { cx } from '../lib/format';

export interface CaptureStatusIndicatorProps {
  state: SessionState;
  isDemo: boolean;
  usesAudio: boolean;
  transcriptionStatus?: TranscriptionStatus;
}

/**
 * Persistent, always-visible capture indicator. It is never hidden while capture is active.
 */
export function CaptureStatusIndicator({ state, isDemo, usesAudio, transcriptionStatus }: CaptureStatusIndicatorProps) {
  let label = 'Not listening';
  let tone = 'bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-300';
  let icon = <MicOff className="size-3.5" aria-hidden />;
  let pulse = false;

  if (state === 'requesting-permission') {
    label = 'Requesting permission…';
    tone = 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200';
    icon = <LoaderCircle className="size-3.5 animate-spin" aria-hidden />;
  } else if (state === 'listening') {
    if (isDemo) {
      label = 'Demo playing — no audio captured';
      tone = 'bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-200';
      icon = <Mic className="size-3.5" aria-hidden />;
    } else if (!usesAudio) {
      label = 'Practice — microphone off';
      tone = 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200';
    } else {
      label = transcriptionStatus === 'reconnecting' ? 'Listening — reconnecting…' : 'Listening';
      tone = 'bg-red-600 text-white';
      icon = <Mic className="size-3.5" aria-hidden />;
      pulse = true;
    }
  } else if (state === 'paused') {
    label = 'Paused — not transcribing';
    tone = 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200';
    icon = <Pause className="size-3.5" aria-hidden />;
  } else if (state === 'stopping') {
    label = 'Stopping…';
    icon = <LoaderCircle className="size-3.5 animate-spin" aria-hidden />;
  } else if (state === 'error') {
    label = 'Stopped — error';
    tone = 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200';
    icon = <TriangleAlert className="size-3.5" aria-hidden />;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="capture-indicator"
      data-state={state}
      className={cx('inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap', tone)}
    >
      <span
        className={cx(
          'relative inline-flex size-2 rounded-full',
          state === 'listening' && usesAudio && !isDemo ? 'bg-white animate-pulse-ring' : 'bg-current opacity-70',
        )}
        aria-hidden
      />
      {icon}
      <span>{label}</span>
      {pulse && <span className="sr-only">Microphone or system audio is being captured.</span>}
    </div>
  );
}
