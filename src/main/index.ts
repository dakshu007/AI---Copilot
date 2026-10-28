import { join } from 'node:path';
import { BrowserWindow, Menu, app, safeStorage, session as electronSession, shell } from 'electron';
import { registerIpcHandlers } from './ipc/handlers';
import { hardenSession, hardenWindow } from './security';
import { enableMacSystemAudioFeatures, installDisplayMediaHandler } from './services/audio/systemAudio';
import { createAnswerProvider, createTranscriptionProvider } from './services/providerFactory';
import { SessionController } from './services/session/SessionController';
import { createSafeStorageCipher } from './services/storage/cipher';
import { HistoryStore } from './services/storage/HistoryStore';
import { PrivacyController } from './services/storage/PrivacyController';
import { ProfileStore } from './services/storage/ProfileStore';
import { SecureSettingsService } from './services/storage/SecureSettingsService';
import { IPC } from '@shared/ipc';
import type { SessionEvent } from '@shared/types';

// Test hooks: isolated data directory and faster demo playback.
if (process.env.COPILOT_USER_DATA_DIR) app.setPath('userData', process.env.COPILOT_USER_DATA_DIR);
const demoSpeed = Number(process.env.COPILOT_DEMO_SPEED ?? '1') || 1;
const devServerUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;

enableMacSystemAudioFeatures();
app.setName('Interview Copilot');

// Keep the audio pipeline, transcription and answer generation running at full speed when the
// dashboard is minimized or in the background. Without these, Chromium throttles background
// renderer timers, which would stall capture during a meeting.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

let mainWindow: BrowserWindow | null = null;
/** Optional compact answer window the user can keep on a second monitor or beside Teams. */
let overlayWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    // Edit menu is required on macOS for Cmd+C / Cmd+V / Cmd+A to work in text fields.
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Privacy & data handling',
          click: () => mainWindow?.webContents.send(IPC.sessionEvent, { type: 'notice', level: 'info', message: 'See Settings → Privacy for what data goes where.' }),
        },
        { label: 'Deepgram API keys', click: () => void shell.openExternal('https://console.deepgram.com/') },
        { label: 'Anthropic API keys', click: () => void shell.openExternal('https://console.anthropic.com/') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(settings: SecureSettingsService): Promise<BrowserWindow> {
  const { ui } = settings.get();
  const isMac = process.platform === 'darwin';
  const window = new BrowserWindow({
    width: ui.compact ? 460 : 1240,
    height: ui.compact ? 760 : 820,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'Interview Copilot',
    backgroundColor: '#0b0d12',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    // Always-on-top is opt-in and the UI explains it is visible in screen sharing.
    alwaysOnTop: ui.alwaysOnTop,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
      // Keep processing while minimized / in the background.
      backgroundThrottling: false,
    },
  });
  // Intentionally NOT calling setContentProtection(): this app never hides itself from
  // screen sharing or screen recording.
  hardenWindow(window, { devServerUrl });
  window.once('ready-to-show', () => window.show());
  if (devServerUrl) await window.loadURL(devServerUrl);
  else await window.loadFile(join(__dirname, '../renderer/index.html'));
  return window;
}

/**
 * A small, separate window that mirrors the latest suggested answers and transcript. The user
 * can move it to a second monitor or keep it beside Teams, and share only their main screen or a
 * single application window so this window is not in the shared view.
 *
 * This is NOT screen-capture evasion: it is a normal window. If the user shares the whole
 * desktop (or this window), it is visible like any other window.
 */
async function createOverlayWindow(): Promise<BrowserWindow> {
  const isMac = process.platform === 'darwin';
  const window = new BrowserWindow({
    width: 440,
    height: 640,
    minWidth: 320,
    minHeight: 360,
    show: false,
    title: 'Answers — Interview Copilot',
    backgroundColor: '#0b0d12',
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 12, y: 12 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
      backgroundThrottling: false,
    },
  });
  // Float above full-screen meeting apps on the user's own screen.
  window.setAlwaysOnTop(true, 'floating');
  if (isMac) window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hardenWindow(window, { devServerUrl });
  window.once('ready-to-show', () => window.show());
  if (devServerUrl) await window.loadURL(`${devServerUrl}#overlay`);
  else await window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'overlay' });
  return window;
}

async function toggleOverlay(): Promise<boolean> {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
    return false;
  }
  overlayWindow = await createOverlayWindow();
  overlayWindow.on('closed', () => {
    overlayWindow = null;
    notifyOverlayState(false);
  });
  notifyOverlayState(true);
  return true;
}

function notifyOverlayState(open: boolean): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.sessionEvent, { type: 'overlay-state', open });
  }
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  const dataDir = app.getPath('userData');
  const cipher = createSafeStorageCipher(safeStorage, process.platform);
  const settings = new SecureSettingsService(dataDir, cipher);
  await settings.load();
  const profiles = new ProfileStore(dataDir, cipher);
  const history = new HistoryStore(dataDir, cipher);
  const privacy = new PrivacyController(settings, profiles, history);
  void privacy.applyRetention().catch(() => undefined);

  // Broadcast session events to every window so the answer window stays in sync with the dashboard.
  const emit = (event: SessionEvent) => {
    for (const window of [mainWindow, overlayWindow]) {
      if (window && !window.isDestroyed()) window.webContents.send(IPC.sessionEvent, event);
    }
  };
  const session = new SessionController({
    getSettings: () => settings.get(),
    getProfile: () => profiles.getProfile(),
    getJob: () => profiles.getJob(),
    createTranscription: ({ forceDemo, mode }) => createTranscriptionProvider(settings, { forceDemo, demoSpeed, mode }),
    createAnswerProvider: () => createAnswerProvider(settings),
    saveSession: (record) => history.save(record),
    emit,
  });

  hardenSession(electronSession.defaultSession, { devServerUrl });
  installDisplayMediaHandler();
  buildMenu();
  registerIpcHandlers({
    getWindow: () => mainWindow,
    settings,
    profiles,
    history,
    privacy,
    session,
    devServerUrl,
    toggleOverlay: () => toggleOverlay(),
    isOverlayOpen: () => Boolean(overlayWindow && !overlayWindow.isDestroyed()),
  });

  mainWindow = await createWindow(settings);
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Closing the dashboard ends capture and closes the answer window.
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
    overlayWindow = null;
    void session.stop();
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = await createWindow(settings);
  });
  app.on('before-quit', () => {
    void session.stop();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

bootstrap().catch((error) => {
  console.error('Failed to start Interview Copilot:', error instanceof Error ? error.message : error);
  app.quit();
});
