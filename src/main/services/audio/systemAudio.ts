import { app, desktopCapturer, session as electronSession, systemPreferences } from 'electron';
import type { SystemAudioSupport } from '@shared/types';

/**
 * macOS system-audio capture.
 *
 * Chromium can capture system audio on macOS through `getDisplayMedia` when these features
 * are enabled (Core Audio taps on macOS 14.2+, ScreenCaptureKit on macOS 13+). The OS still
 * asks the user for "Screen & System Audio Recording" permission; we never bypass that.
 * Must run before `app.ready`.
 */
export function enableMacSystemAudioFeatures(): void {
  if (process.platform !== 'darwin') return;
  const existing = app.commandLine.getSwitchValue('enable-features');
  const features = ['MacLoopbackAudioForScreenShare', 'MacCatapLoopbackAudioForScreenShare'];
  app.commandLine.appendSwitch('enable-features', [existing, ...features].filter(Boolean).join(','));
}

export function macOSVersion(): [number, number] {
  if (process.platform !== 'darwin') return [0, 0];
  const [major = 0, minor = 0] = (process.getSystemVersion?.() ?? '0.0').split('.').map(Number);
  return [major, minor];
}

export function systemAudioSupport(): SystemAudioSupport {
  if (process.platform === 'win32') {
    return { supported: true, method: 'loopback', note: 'System audio is captured with Windows loopback capture.' };
  }
  if (process.platform === 'darwin') {
    const [major, minor] = macOSVersion();
    const supported = major > 14 || (major === 14 && minor >= 2) || major === 13;
    return supported
      ? {
          supported: true,
          method: 'loopback',
          note:
            'macOS will ask for "Screen & System Audio Recording" permission the first time. If capture fails, select a virtual device such as BlackHole as the input instead.',
        }
      : {
          supported: false,
          method: 'virtual-device-only',
          note: 'System audio capture needs macOS 13 or later. Use a virtual audio device such as BlackHole and select it as the microphone.',
        };
  }
  return {
    supported: false,
    method: 'virtual-device-only',
    note: 'On Linux, select your PulseAudio/PipeWire "Monitor" source as the microphone to capture system audio.',
  };
}

/**
 * Answer `getDisplayMedia()` requests from our renderer with the primary screen plus loopback
 * audio. The renderer immediately stops the video track; only audio is used. This is only
 * reachable after the user presses Start with "system audio" selected.
 */
export function installDisplayMediaHandler(): void {
  electronSession.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          const source = sources[0];
          if (!source) {
            callback({});
            return;
          }
          callback({ video: source, audio: 'loopback' });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
}

export type MicrophoneStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';

/** On macOS, trigger the system microphone prompt (TCC) before getUserMedia. */
export async function requestMicrophoneAccess(): Promise<MicrophoneStatus> {
  if (process.platform !== 'darwin') return 'granted';
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') return 'granted';
  if (status === 'not-determined') {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    return granted ? 'granted' : 'denied';
  }
  return status as MicrophoneStatus;
}

export const MAC_PRIVACY_URLS = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
} as const;
