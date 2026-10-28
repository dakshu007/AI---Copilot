import { useState } from 'react';
import { Check, KeyRound, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { ConnectionTestResult, PublicSettings, SecretKind, SettingsUpdate } from '@shared/types';

export interface ProviderSettingsProps {
  value: PublicSettings;
  onUpdate(update: SettingsUpdate): Promise<void>;
  onSetSecret(kind: SecretKind, value: string): Promise<void>;
  onClearSecret(kind: SecretKind): Promise<void>;
  onTest(kind: SecretKind): Promise<ConnectionTestResult>;
}

const LLM_DEFAULT_MODELS = {
  anthropic: 'claude-opus-5-5',
  'openai-compatible': 'gpt-4.1-mini',
  demo: 'demo',
} as const;

const TRANSCRIPTION_DEFAULT_MODELS = {
  deepgram: 'nova-3',
  'openai-whisper': 'whisper-1',
  demo: 'demo',
} as const;

const BASE_URL_PRESETS = [
  { label: 'OpenAI', url: 'https://api.openai.com/v1' },
  { label: 'Groq', url: 'https://api.groq.com/openai/v1' },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { label: 'Ollama (local)', url: 'http://localhost:11434/v1' },
  { label: 'LM Studio (local)', url: 'http://localhost:1234/v1' },
];

export function ProviderSettings({ value, onUpdate, onSetSecret, onClearSecret, onTest }: ProviderSettingsProps) {
  const { settings, secrets, secureStorage } = value;
  return (
    <div className="space-y-6">
      {!secureStorage.available && (
        <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100" role="note">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Secure credential storage is unavailable on this system, so API keys are kept in memory only and must be re-entered after restarting.
        </p>
      )}

      <section className="card space-y-4 p-4" aria-labelledby="llm-heading">
        <h3 id="llm-heading" className="font-semibold">Answer provider (LLM)</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="label">Provider</span>
            <select
              className="input"
              value={settings.llm.provider}
              data-testid="llm-provider"
              onChange={(event) => {
                const provider = event.target.value as keyof typeof LLM_DEFAULT_MODELS;
                void onUpdate({ llm: { provider, model: LLM_DEFAULT_MODELS[provider] } });
              }}
            >
              <option value="demo">Demo — offline, no AI (uses only your profile)</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="openai-compatible">OpenAI-compatible API</option>
            </select>
          </label>
          {settings.llm.provider !== 'demo' && (
            <label className="block">
              <span className="label">Model</span>
              <input
                className="input"
                list={settings.llm.provider === 'anthropic' ? 'anthropic-models' : undefined}
                defaultValue={settings.llm.model}
                key={`${settings.llm.provider}-${settings.llm.model}`}
                onBlur={(event) => event.target.value.trim() && onUpdate({ llm: { model: event.target.value.trim() } })}
                data-testid="llm-model"
              />
              <datalist id="anthropic-models">
                <option value="claude-opus-5-5">Claude Opus 5.5 — most capable</option>
                <option value="claude-sonnet-5-5">Claude Sonnet 5.5 — faster</option>
                <option value="claude-haiku-5-5">Claude Haiku 5.5 — fastest, lowest cost</option>
              </datalist>
            </label>
          )}
          {settings.llm.provider === 'openai-compatible' && (
            <label className="block md:col-span-2">
              <span className="label">Base URL</span>
              <div className="flex gap-2">
                <input
                  className="input"
                  defaultValue={settings.llm.baseUrl}
                  key={settings.llm.baseUrl}
                  onBlur={(event) => onUpdate({ llm: { baseUrl: event.target.value.trim() } })}
                  aria-label="Base URL"
                />
                <select
                  className="input w-44"
                  aria-label="Base URL preset"
                  value=""
                  onChange={(event) => event.target.value && onUpdate({ llm: { baseUrl: event.target.value } })}
                >
                  <option value="">Presets…</option>
                  {BASE_URL_PRESETS.map((preset) => (
                    <option key={preset.url} value={preset.url}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          )}
          {settings.llm.provider === 'anthropic' && (
            <label className="block">
              <span className="label">Response speed</span>
              <select
                className="input"
                value={settings.llm.effort}
                onChange={(event) => onUpdate({ llm: { effort: event.target.value as 'low' | 'medium' | 'high' } })}
              >
                <option value="low">Fastest (low effort)</option>
                <option value="medium">Balanced</option>
                <option value="high">Most thorough (slower)</option>
              </select>
            </label>
          )}
        </div>
        {settings.llm.provider !== 'demo' && (
          <SecretField
            kind="llm"
            label={settings.llm.provider === 'anthropic' ? 'Anthropic API key' : 'API key'}
            status={secrets.llm}
            onSave={onSetSecret}
            onClear={onClearSecret}
            onTest={onTest}
          />
        )}
      </section>

      <section className="card space-y-4 p-4" aria-labelledby="stt-heading">
        <h3 id="stt-heading" className="font-semibold">Transcription provider</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="label">Provider</span>
            <select
              className="input"
              value={settings.transcription.provider}
              data-testid="stt-provider"
              onChange={(event) => {
                const provider = event.target.value as keyof typeof TRANSCRIPTION_DEFAULT_MODELS;
                void onUpdate({ transcription: { provider, model: TRANSCRIPTION_DEFAULT_MODELS[provider] } });
              }}
            >
              <option value="demo">Demo — scripted interview, no audio</option>
              <option value="deepgram">Deepgram — real-time streaming (recommended)</option>
              <option value="openai-whisper">OpenAI-compatible Whisper — near real-time</option>
            </select>
          </label>
          {settings.transcription.provider !== 'demo' && (
            <label className="block">
              <span className="label">Model</span>
              <input
                className="input"
                defaultValue={settings.transcription.model}
                key={`${settings.transcription.provider}-${settings.transcription.model}`}
                onBlur={(event) => event.target.value.trim() && onUpdate({ transcription: { model: event.target.value.trim() } })}
              />
            </label>
          )}
          {settings.transcription.provider === 'openai-whisper' && (
            <label className="block">
              <span className="label">Base URL</span>
              <input
                className="input"
                defaultValue={settings.transcription.baseUrl}
                key={settings.transcription.baseUrl}
                onBlur={(event) => onUpdate({ transcription: { baseUrl: event.target.value.trim() } })}
              />
            </label>
          )}
          <label className="block">
            <span className="label">Language</span>
            <select
              className="input"
              value={settings.transcription.language}
              onChange={(event) => onUpdate({ transcription: { language: event.target.value } })}
            >
              {[
                ['en', 'English'],
                ['en-US', 'English (US)'],
                ['en-GB', 'English (UK)'],
                ['en-IN', 'English (India)'],
                ['es', 'Spanish'],
                ['fr', 'French'],
                ['de', 'German'],
                ['hi', 'Hindi'],
                ['pt', 'Portuguese'],
                ['ja', 'Japanese'],
              ].map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {settings.transcription.provider !== 'demo' && (
          <SecretField
            kind="transcription"
            label={settings.transcription.provider === 'deepgram' ? 'Deepgram API key' : 'Transcription API key'}
            status={secrets.transcription}
            onSave={onSetSecret}
            onClear={onClearSecret}
            onTest={onTest}
          />
        )}
      </section>
    </div>
  );
}

interface SecretFieldProps {
  kind: SecretKind;
  label: string;
  status: PublicSettings['secrets'][SecretKind];
  onSave(kind: SecretKind, value: string): Promise<void>;
  onClear(kind: SecretKind): Promise<void>;
  onTest(kind: SecretKind): Promise<ConnectionTestResult>;
}

function SecretField({ kind, label, status, onSave, onClear, onTest }: SecretFieldProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy('save');
    setError('');
    setResult(null);
    try {
      await onSave(kind, value.trim());
      setValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    setError('');
    try {
      setResult(await onTest(kind));
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="label">{label}</span>
        <div className="flex flex-wrap gap-2">
          <input
            className="input max-w-md flex-1 font-mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder={status.set ? `Saved key ending in …${status.hint || '****'}` : 'Paste your API key'}
            onChange={(event) => setValue(event.target.value)}
            data-testid={`${kind}-key-input`}
          />
          <button type="button" className="btn-primary" disabled={!value.trim() || busy !== null} onClick={save} data-testid={`${kind}-key-save`}>
            <KeyRound className="size-4" aria-hidden /> Save key
          </button>
          <button type="button" className="btn-secondary" disabled={!status.set || busy !== null} onClick={test} data-testid={`${kind}-key-test`}>
            {busy === 'test' ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            Test connection
          </button>
          {status.set && (
            <button type="button" className="btn-ghost text-red-600 dark:text-red-400" disabled={busy !== null} onClick={() => onClear(kind)}>
              Remove key
            </button>
          )}
        </div>
      </label>
      <p className="text-xs text-slate-500 dark:text-slate-400" data-testid={`${kind}-key-status`}>
        {status.set
          ? status.storage === 'persisted'
            ? `Key saved (…${status.hint || '****'}), encrypted with your system keychain.`
            : `Key kept in memory only (…${status.hint || '****'}); it is forgotten when the app quits.`
          : 'No key saved. Keys are never written to logs, exports or the renderer.'}
      </p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {result && (
        <p className={`flex items-center gap-1.5 text-sm ${result.ok ? 'text-emerald-600' : 'text-red-600'}`} role="status">
          {result.ok ? <Check className="size-4" aria-hidden /> : <TriangleAlert className="size-4" aria-hidden />}
          {result.message}
          {result.latencyMs !== undefined && <span className="text-slate-400">({result.latencyMs} ms)</span>}
        </p>
      )}
    </div>
  );
}
