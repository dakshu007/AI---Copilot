import { useEffect, useState } from 'react';
import { Keyboard, Shield, TriangleAlert } from 'lucide-react';
import type { AnswerFormat, Settings } from '@shared/types';
import { useCopilot } from '../app/CopilotProvider';
import { listMicrophones } from '../audio/AudioCaptureService';
import { ProviderSettings } from '../components/ProviderSettings';
import { api, errorMessage, unwrap } from '../lib/api';
import { FORMAT_LABELS, MOD } from '../lib/format';

const HOTKEYS: Array<[string, string]> = [
  [`${MOD}+Enter`, 'Start session'],
  [`${MOD}+.`, 'Stop session'],
  [`${MOD}+Shift+P`, 'Pause / resume'],
  [`${MOD}+Shift+Q`, 'Answer selected transcript text'],
  [`${MOD}+Shift+C`, 'Copy latest answer'],
  ['Esc', 'Cancel answer generation'],
  [`${MOD}+1…4`, 'Switch page'],
];

export function SettingsPage() {
  const { settings, updateSettings, refreshSettings, notify, platform } = useCopilot();
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    void listMicrophones().then(setMicrophones).catch(() => undefined);
  }, []);

  if (!settings) return null;
  const s: Settings = settings.settings;
  const update = (patch: Parameters<typeof updateSettings>[0]) =>
    updateSettings(patch).catch((error) => notify('error', errorMessage(error)));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 overflow-y-auto pb-10">
      <section className="space-y-3" aria-labelledby="providers-heading">
        <h2 id="providers-heading" className="text-lg font-semibold">AI providers (bring your own key)</h2>
        <ProviderSettings
          value={settings}
          onUpdate={update}
          onSetSecret={async (kind, value) => {
            await unwrap(api().settings.setSecret(kind, value));
            await refreshSettings();
          }}
          onClearSecret={async (kind) => {
            await unwrap(api().settings.clearSecret(kind));
            await refreshSettings();
          }}
          onTest={(kind) => unwrap(kind === 'llm' ? api().settings.testLlm() : api().settings.testTranscription())}
        />
      </section>

      <section className="card space-y-3 p-4" aria-labelledby="audio-heading">
        <h2 id="audio-heading" className="font-semibold">Audio</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="label">Microphone</span>
            <select
              className="input"
              value={s.audio.microphoneDeviceId ?? ''}
              onChange={(event) => update({ audio: { microphoneDeviceId: event.target.value || undefined } })}
            >
              <option value="">System default</option>
              {microphones.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || 'Microphone'}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Audio source for live sessions</span>
            <select className="input" value={s.audio.source} onChange={(event) => update({ audio: { source: event.target.value as Settings['audio']['source'] } })}>
              <option value="microphone">Microphone only</option>
              <option value="system">System audio only (the interviewer)</option>
              <option value="both">Microphone + system audio (labels You / Interviewer)</option>
            </select>
          </label>
        </div>
        {platform && <p className="text-xs text-slate-500 dark:text-slate-400">{platform.systemAudio.note}</p>}
        <p className="text-xs text-slate-500 dark:text-slate-400">Audio is never recorded to disk. Device names appear after microphone permission is granted.</p>
      </section>

      <section className="card space-y-3 p-4" aria-labelledby="answers-heading">
        <h2 id="answers-heading" className="font-semibold">Answers</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="label">Default style</span>
            <select className="input" value={s.answers.defaultFormat} onChange={(event) => update({ answers: { defaultFormat: event.target.value as AnswerFormat } })}>
              {(Object.keys(FORMAT_LABELS) as AnswerFormat[]).map((format) => (
                <option key={format} value={format}>
                  {FORMAT_LABELS[format]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Max words ({s.answers.maxWords})</span>
            <input
              type="range"
              min={40}
              max={300}
              step={10}
              className="w-full accent-indigo-600"
              value={s.answers.maxWords}
              onChange={(event) => update({ answers: { maxWords: Number(event.target.value) } })}
            />
          </label>
          <div className="space-y-2 pt-5 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.answers.autoStyle} onChange={(event) => update({ answers: { autoStyle: event.target.checked } })} />
              STAR / technical style by question type
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.answers.autoGenerate} onChange={(event) => update({ answers: { autoGenerate: event.target.checked } })} />
              Generate answers automatically
            </label>
          </div>
        </div>
      </section>

      <section className="card space-y-3 p-4" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" className="flex items-center gap-2 font-semibold">
          <Shield className="size-4" aria-hidden /> Privacy &amp; data
        </h2>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={s.privacy.consentTranscription}
              onChange={(event) => update({ privacy: { consentTranscription: event.target.checked } })}
              data-testid="consent-transcription-setting"
            />
            <span>
              Allow streaming audio to my transcription provider ({s.transcription.provider}). Audio leaves this Mac when a cloud provider is used.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={s.privacy.consentLlm}
              onChange={(event) => update({ privacy: { consentLlm: event.target.checked } })}
              data-testid="consent-llm-setting"
            />
            <span>Allow sending questions, recent transcript lines and relevant profile facts to my AI provider ({s.llm.provider}).</span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={s.privacy.historyEnabled}
              onChange={(event) => update({ privacy: { historyEnabled: event.target.checked } })}
              data-testid="history-setting"
            />
            <span>Save session transcripts and answers on this Mac (off by default).</span>
          </label>
          <label className="flex items-center gap-2">
            Delete saved sessions after
            <select
              className="input w-auto py-1"
              value={s.privacy.retentionDays}
              onChange={(event) => update({ privacy: { retentionDays: Number(event.target.value) } })}
            >
              {[1, 7, 30, 90, 365].map((days) => (
                <option key={days} value={days}>
                  {days} {days === 1 ? 'day' : 'days'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3 dark:border-white/10">
          <button
            type="button"
            className="btn-danger"
            data-testid="delete-all-data"
            onClick={async () => {
              if (!window.confirm('Delete ALL local data: API keys, profile, job description, history and settings? This cannot be undone.')) return;
              try {
                await unwrap(api().privacy.deleteAllData());
                await refreshSettings();
                notify('info', 'All local data was deleted.');
              } catch (error) {
                notify('error', errorMessage(error));
              }
            }}
          >
            Delete all local data
          </button>
          <p className="text-xs text-slate-500 dark:text-slate-400">No analytics or telemetry are collected. Nothing is uploaded in the background.</p>
        </div>
      </section>

      <section className="card space-y-3 p-4" aria-labelledby="window-heading">
        <h2 id="window-heading" className="font-semibold">Window &amp; appearance</h2>
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <label className="block">
            <span className="label">Theme</span>
            <select className="input" value={s.ui.theme} onChange={(event) => update({ ui: { theme: event.target.value as Settings['ui']['theme'] } })}>
              <option value="system">Match macOS</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <div className="space-y-2 pt-5">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.ui.compact} onChange={(event) => update({ ui: { compact: event.target.checked } })} />
              Compact window (to keep beside your meeting app or on a second display)
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={s.ui.alwaysOnTop}
                onChange={(event) => update({ ui: { alwaysOnTop: event.target.checked } })}
                data-testid="always-on-top"
              />
              <span>Keep window on top of other windows</span>
            </label>
          </div>
        </div>
        {s.ui.alwaysOnTop && (
          <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-100" role="note">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            An always-on-top window is a normal window: it will appear to others if you share your entire screen.
          </p>
        )}
      </section>

      <section className="card space-y-3 p-4" aria-labelledby="hotkeys-heading">
        <h2 id="hotkeys-heading" className="flex items-center gap-2 font-semibold">
          <Keyboard className="size-4" aria-hidden /> Keyboard shortcuts
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.ui.hotkeysEnabled} onChange={(event) => update({ ui: { hotkeysEnabled: event.target.checked } })} />
          Enable shortcuts (they work only while this window is focused, so they never clash with Teams, Zoom or Meet controls)
        </label>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {HOTKEYS.map(([keys, action]) => (
            <div key={keys} className="contents">
              <dt>
                <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-xs dark:border-white/15 dark:bg-white/5">{keys}</kbd>
              </dt>
              <dd className="text-slate-600 dark:text-slate-300">{action}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-center text-xs text-slate-400">
        Interview Copilot {platform?.version} · {platform?.platform === 'darwin' ? 'macOS' : platform?.platform} {platform?.arch}
      </p>
    </div>
  );
}
