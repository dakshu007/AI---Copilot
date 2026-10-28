import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { PlatformInfo, PublicSettings, SessionMode, Settings, SettingsUpdate } from '@shared/types';
import { AudioCaptureService } from '../audio/AudioCaptureService';
import { initialSessionStore, sessionReducer, type SessionStore } from '../hooks/useSessionStore';
import { api, errorMessage, unwrap } from '../lib/api';

export interface StartOptions {
  mode: SessionMode;
  demo: boolean;
  /** Practice sessions can run without audio (typed or mock questions). */
  useAudio: boolean;
  permittedAcknowledged: boolean;
  meetingContext?: string;
}

interface CopilotContextValue {
  settings: PublicSettings | null;
  platform: PlatformInfo | null;
  refreshSettings(): Promise<void>;
  updateSettings(update: SettingsUpdate): Promise<void>;
  session: SessionStore;
  startSession(options: StartOptions): Promise<boolean>;
  pauseSession(): Promise<void>;
  resumeSession(): Promise<void>;
  stopSession(): Promise<void>;
  notify(level: 'info' | 'warning' | 'error', message: string): void;
  dismissNotice(id: number): void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

function mergeSettings(current: Settings, update: SettingsUpdate): Settings {
  const next = { ...current } as Record<string, unknown>;
  for (const [section, patch] of Object.entries(update)) {
    if (patch) next[section] = { ...(current as unknown as Record<string, object>)[section], ...patch };
  }
  return next as Settings;
}

export function useCopilot(): CopilotContextValue {
  const value = useContext(CopilotContext);
  if (!value) throw new Error('useCopilot must be used inside CopilotProvider');
  return value;
}

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [session, dispatch] = useReducer(sessionReducer, initialSessionStore);
  const captureRef = useRef(new AudioCaptureService());
  const settingsVersion = useRef(0);
  const levelsAt = useRef(0);

  const notify = useCallback((level: 'info' | 'warning' | 'error', message: string) => {
    dispatch({ type: 'notice', level, message });
  }, []);

  const refreshSettings = useCallback(async () => {
    setSettings(await unwrap(api().settings.get()));
  }, []);

  /** Optimistic: the UI reflects the change immediately and reverts if validation fails. */
  const updateSettings = useCallback(
    async (update: SettingsUpdate) => {
      const version = ++settingsVersion.current;
      setSettings((current) => (current ? { ...current, settings: mergeSettings(current.settings, update) } : current));
      try {
        await unwrap(api().settings.update(update));
      } finally {
        // Only the latest update re-syncs, so a slow refresh never overwrites a newer change.
        if (version === settingsVersion.current) await refreshSettings();
      }
    },
    [refreshSettings],
  );

  useEffect(() => {
    void refreshSettings().catch((error) => notify('error', errorMessage(error)));
    void unwrap(api().app.info())
      .then(setPlatform)
      .catch(() => undefined);
    void unwrap(api().app.overlayState())
      .then((open) => dispatch({ type: 'event', event: { type: 'overlay-state', open } }))
      .catch(() => undefined);
    void unwrap(api().session.snapshot())
      .then((snapshot) =>
        dispatch({
          type: 'hydrate',
          snapshot: {
            state: snapshot.state,
            mode: snapshot.mode,
            isDemo: snapshot.isDemo,
            sessionId: snapshot.sessionId,
            message: snapshot.message,
            segments: snapshot.segments,
            questions: [...snapshot.questions].reverse(),
            answersList: snapshot.answers,
            summary: snapshot.summary,
          },
        }),
      )
      .catch(() => undefined);
    return api().session.onEvent((event) => dispatch({ type: 'event', event }));
  }, [notify, refreshSettings]);

  // Whenever the main process reports the session ended or failed, release the devices.
  useEffect(() => {
    if ((session.state === 'idle' || session.state === 'error') && captureRef.current.isRunning) {
      void captureRef.current.stop();
    }
  }, [session.state]);

  // Release devices if the window is closed or reloaded.
  useEffect(() => {
    const capture = captureRef.current;
    const onUnload = () => void capture.stop();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      void capture.stop();
    };
  }, []);

  const startSession = useCallback(
    async (options: StartOptions): Promise<boolean> => {
      if (!settings) return false;
      const capture = captureRef.current;
      const needsAudio = !options.demo && options.useAudio;
      try {
        let audioChannels: 0 | 1 | 2 = 0;
        let channelLabels: string[] | undefined;
        let sampleRate = 16_000;
        if (needsAudio) {
          dispatch({ type: 'local-state', state: 'requesting-permission' });
          const source = settings.settings.audio.source;
          if (source !== 'system') {
            const status = await unwrap(api().app.requestMicrophone());
            if (status !== 'granted') {
              throw new Error(
                'Microphone access is not allowed. Open System Settings → Privacy & Security → Microphone and enable Interview Copilot.',
              );
            }
          }
          const info = await capture.start({
            source,
            microphoneDeviceId: settings.settings.audio.microphoneDeviceId,
            onFrame: (frame) => api().session.sendAudio(frame),
            onLevels: (levels) => {
              const now = performance.now();
              if (now - levelsAt.current > 120) {
                levelsAt.current = now;
                dispatch({ type: 'levels', levels });
              }
            },
            onEnded: (reason) => {
              notify('warning', `${reason} Capture has stopped.`);
              void captureRef.current.stop();
              void api().session.stop();
            },
          });
          audioChannels = info.channels;
          // In team meetings the other side of the call is your teammates.
          channelLabels =
            options.mode === 'meeting' ? info.channelLabels.map((label) => (label === 'Interviewer' ? 'Teammates' : label)) : info.channelLabels;
          sampleRate = info.sampleRate;
        }
        await unwrap(
          api().session.start({
            mode: options.mode,
            audioChannels,
            channelLabels,
            sampleRate,
            demo: options.demo,
            permittedAcknowledged: options.permittedAcknowledged,
            meetingContext: options.mode === 'meeting' ? options.meetingContext : undefined,
          }),
        );
        return true;
      } catch (error) {
        await capture.stop();
        dispatch({ type: 'local-state', state: 'error', message: errorMessage(error) });
        return false;
      }
    },
    [notify, settings],
  );

  const pauseSession = useCallback(async () => {
    await captureRef.current.pause();
    await unwrap(api().session.pause()).catch((error) => notify('error', errorMessage(error)));
  }, [notify]);

  const resumeSession = useCallback(async () => {
    await captureRef.current.resume();
    await unwrap(api().session.resume()).catch((error) => notify('error', errorMessage(error)));
  }, [notify]);

  /** Stop always works: local capture is released first, regardless of the main process. */
  const stopSession = useCallback(async () => {
    await captureRef.current.stop();
    try {
      await unwrap(api().session.stop());
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      dispatch({ type: 'local-state', state: 'idle' });
    }
  }, [notify]);

  const value = useMemo<CopilotContextValue>(
    () => ({
      settings,
      platform,
      refreshSettings,
      updateSettings,
      session,
      startSession,
      pauseSession,
      resumeSession,
      stopSession,
      notify,
      dismissNotice: (id) => dispatch({ type: 'dismiss-notice', id }),
    }),
    [settings, platform, refreshSettings, updateSettings, session, startSession, pauseSession, resumeSession, stopSession, notify],
  );

  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>;
}
