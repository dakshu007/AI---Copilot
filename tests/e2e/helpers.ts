import { lstatSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
}

export async function launchApp(options: { userDataDir?: string; skipOnboarding?: boolean } = {}): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'copilot-e2e-'));
  const app = await electron.launch({
    args: [
      resolve(__dirname, '../..'),
      '--no-sandbox',
      // Chromium's fake microphone (a periodic beep) and auto-accepted permission prompt.
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
    env: { ...process.env, COPILOT_USER_DATA_DIR: userDataDir, COPILOT_DEMO_SPEED: '8', NODE_ENV: 'production' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  if (options.skipOnboarding !== false) {
    // A fresh profile always shows onboarding once settings have loaded.
    const done = page.getByTestId('onboarding-done');
    const appeared = await done.waitFor({ state: 'visible', timeout: 10_000 }).then(
      () => true,
      () => false,
    );
    if (appeared) {
      await done.click();
      await done.waitFor({ state: 'detached' });
    }
  }
  return { app, page, userDataDir };
}

/** Concatenate every file under the user data directory (to look for leaked secrets). */
export function readAllFiles(dir: string): string {
  let out = '';
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    try {
      const stat = lstatSync(path);
      if (stat.isDirectory()) out += readAllFiles(path);
      else if (stat.isFile() && stat.size < 5_000_000) out += readFileSync(path).toString('latin1');
    } catch {
      // Chromium creates and removes lock/socket files while running.
    }
  }
  return out;
}
