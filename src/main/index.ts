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

let mainWindow: BrowserWindow | null = null;

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

  const emit = (event: SessionEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.sessionEvent, event);
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
  registerIpcHandlers({ getWindow: () => mainWindow, settings, profiles, history, privacy, session, devServerUrl });

  mainWindow = await createWindow(settings);
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Closing the window always ends capture.
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
