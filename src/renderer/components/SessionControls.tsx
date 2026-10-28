import { Pause, Play, Square, LoaderCircle } from 'lucide-react';
import type { SessionState } from '@shared/types';
import { MOD } from '../lib/format';

export interface SessionControlsProps {
  state: SessionState;
  canStart: boolean;
  startLabel?: string;
  startDisabledReason?: string;
  onStart(): void;
  onPause(): void;
  onResume(): void;
  onStop(): void;
}

/** Start / Pause / Stop. Stop is available in every non-idle state, including errors. */
export function SessionControls({
  state,
  canStart,
  startLabel = 'Start session',
  startDisabledReason,
  onStart,
  onPause,
  onResume,
  onStop,
}: SessionControlsProps) {
  const running = state === 'listening' || state === 'paused' || state === 'requesting-permission' || state === 'stopping';
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Session controls">
      {!running && (
        <button
          type="button"
          className="btn-primary"
          onClick={onStart}
          disabled={!canStart}
          title={startDisabledReason ?? `${startLabel} (${MOD}+Enter)`}
          data-testid="start-session"
        >
          <Play className="size-4" aria-hidden />
          {startLabel}
        </button>
      )}
      {state === 'listening' && (
        <button type="button" className="btn-secondary" onClick={onPause} data-testid="pause-session" title={`Pause (${MOD}+Shift+P)`}>
          <Pause className="size-4" aria-hidden />
          Pause
        </button>
      )}
      {state === 'paused' && (
        <button type="button" className="btn-secondary" onClick={onResume} data-testid="resume-session" title={`Resume (${MOD}+Shift+P)`}>
          <Play className="size-4" aria-hidden />
          Resume
        </button>
      )}
      {(running || state === 'error') && (
        <button
          type="button"
          className="btn-danger"
          onClick={onStop}
          disabled={state === 'stopping'}
          data-testid="stop-session"
          title={`Stop (${MOD}+.)`}
        >
          {state === 'stopping' ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Square className="size-4" aria-hidden />}
          {state === 'error' ? 'Reset' : 'Stop'}
        </button>
      )}
      {!running && startDisabledReason && !canStart && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{startDisabledReason}</p>
      )}
    </div>
  );
}
