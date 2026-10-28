import { useEffect, useState } from 'react';
import { Clock, Mic, Settings as SettingsIcon, ShieldCheck, User } from 'lucide-react';
import { Notices } from '../components/Notices';
import { HistoryPage } from '../pages/HistoryPage';
import { ProfilePage } from '../pages/ProfilePage';
import { SessionPage } from '../pages/SessionPage';
import { SettingsPage } from '../pages/SettingsPage';
import { cx, isMac } from '../lib/format';
import { useCopilot } from './CopilotProvider';

type Page = 'session' | 'profile' | 'history' | 'settings';

const NAV: Array<{ id: Page; label: string; icon: typeof Mic }> = [
  { id: 'session', label: 'Session', icon: Mic },
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'history', label: 'History', icon: Clock },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export function App() {
  const { settings, session, dismissNotice, updateSettings } = useCopilot();
  const [page, setPage] = useState<Page>('session');
  const theme = settings?.settings.ui.theme ?? 'system';
  const compact = settings?.settings.ui.compact ?? false;
  const hotkeys = settings?.settings.ui.hotkeysEnabled ?? true;

  // Theme: explicit choice or follow macOS appearance.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  // Navigation shortcuts.
  useEffect(() => {
    if (!hotkeys) return;
    const onKey = (event: KeyboardEvent) => {
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (!mod || event.shiftKey || event.altKey) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < NAV.length) {
        event.preventDefault();
        setPage(NAV[index]!.id);
      } else if (event.key === ',') {
        event.preventDefault();
        setPage('settings');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkeys]);

  // Info notices disappear on their own; warnings and errors stay until dismissed.
  useEffect(() => {
    const timers = session.notices
      .filter((notice) => notice.level === 'info')
      .map((notice) => setTimeout(() => dismissNotice(notice.id), 6_000));
    return () => timers.forEach(clearTimeout);
  }, [session.notices, dismissNotice]);

  const capturing = session.state === 'listening' && session.mode === 'assist' && !session.isDemo;

  return (
    <div className={cx('flex h-full', compact ? 'flex-col' : 'flex-row')}>
      <nav
        aria-label="Main"
        className={cx(
          'drag-region shrink-0 border-slate-200 bg-white/70 backdrop-blur dark:border-white/10 dark:bg-white/[0.02]',
          compact ? 'flex items-center gap-1 border-b px-2 pt-8 pb-1.5' : 'flex w-52 flex-col gap-1 border-r px-3 pt-12 pb-4',
        )}
      >
        {!compact && (
          <div className="mb-4 px-2">
            <p className="text-sm font-bold tracking-tight">Interview Copilot</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Transparent interview practice</p>
          </div>
        )}
        {NAV.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setPage(item.id)}
              aria-current={page === item.id ? 'page' : undefined}
              data-testid={`nav-${item.id}`}
              title={`${item.label} (${isMac ? '⌘' : 'Ctrl+'}${index + 1})`}
              className={cx(
                'no-drag flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors',
                page === item.id
                  ? 'bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-200'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {(!compact || page === item.id) && item.label}
              {item.id === 'session' && capturing && <span className="ml-auto size-2 rounded-full bg-red-500" aria-label="capturing" />}
            </button>
          );
        })}
        {!compact && (
          <div className="mt-auto flex items-start gap-1.5 px-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Local-first. Your keys stay in the macOS Keychain. No stealth features.
          </div>
        )}
      </nav>

      <main className={cx('flex min-h-0 min-w-0 flex-1 flex-col', compact ? 'p-2' : 'px-5 pt-10 pb-4')}>
        {page === 'session' && <SessionPage onNavigate={setPage} />}
        {page === 'profile' && <ProfilePage />}
        {page === 'history' && <HistoryPage />}
        {page === 'settings' && <SettingsPage />}
      </main>

      <Notices notices={session.notices} onDismiss={dismissNotice} />

      {settings && !settings.settings.ui.onboardingDone && (
        <Onboarding onDone={() => void updateSettings({ ui: { onboardingDone: true } })} />
      )}
    </div>
  );
}

function Onboarding({ onDone }: { onDone(): void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="card max-w-lg space-y-4 p-6 shadow-xl dark:bg-slate-900">
        <h2 id="onboarding-title" className="text-xl font-semibold">Welcome to Interview Copilot</h2>
        <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
          <li>
            <strong>Practice mode</strong> — rehearse with mock questions or a demo interview. Works offline with no API key.
          </li>
          <li>
            <strong>Permitted assistance</strong> — live transcription and answer suggestions, only for interviews where the organizer allows AI help.
          </li>
          <li>
            <strong>Transparent by design</strong> — this is a normal window. It is visible if you share your screen, and it never hides from Teams, Zoom or
            Meet.
          </li>
          <li>
            <strong>Grounded answers</strong> — suggestions only use facts you confirm on the Profile page. Missing details are flagged, never invented.
          </li>
          <li>
            <strong>Your keys, your data</strong> — bring your own API keys; nothing is sent anywhere until you start a session and give consent.
          </li>
        </ul>
        <button type="button" className="btn-primary w-full" onClick={onDone} autoFocus data-testid="onboarding-done">
          Get started
        </button>
      </div>
    </div>
  );
}
