import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { launchApp, readAllFiles, type LaunchedApp } from './helpers';

let launched: LaunchedApp | null = null;

test.afterEach(async () => {
  await launched?.app.close().catch(() => undefined);
  launched = null;
});

test('launches with a hardened renderer and first-run onboarding', async () => {
  launched = await launchApp({ skipOnboarding: false });
  const { page, app } = launched;
  await expect(page.getByRole('dialog', { name: 'Welcome to Interview Copilot' })).toBeVisible();
  await expect(page.getByText(/never hides from Teams, Zoom or/)).toBeVisible();
  await page.getByTestId('onboarding-done').click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // The renderer has no Node.js access; only the narrow bridge is exposed.
  const exposure = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    buffer: typeof (window as unknown as { Buffer?: unknown }).Buffer,
    bridge: Object.keys((window as unknown as { copilot: object }).copilot).sort(),
  }));
  expect(exposure).toEqual({ require: 'undefined', process: 'undefined', buffer: 'undefined', bridge: ['app', 'history', 'job', 'privacy', 'profile', 'session', 'settings'] });

  // The window was created with the hardened preferences.
  const hardened = await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]!.webContents;
    return { url: contents.getURL().startsWith('file://'), devTools: contents.isDevToolsOpened() };
  });
  expect(hardened).toEqual({ url: true, devTools: false });

  // Navigation via sidebar and keyboard.
  await page.getByTestId('nav-settings').click();
  await expect(page.getByRole('heading', { name: 'AI providers (bring your own key)' })).toBeVisible();
  await page.keyboard.press('Control+2');
  await expect(page.getByRole('heading', { name: 'Resume profile' })).toBeVisible();
  await expect(page.getByTestId('capture-indicator')).toHaveCount(0);
  await page.getByTestId('nav-session').click();
  await expect(page.getByTestId('capture-indicator')).toHaveText(/Not listening/);
});

test('practice mode answers typed questions with labelled demo answers', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.getByTestId('practice-input').fill('How would you design a rate limiter?');
  await page.getByTestId('practice-ask').click();
  const card = page.getByTestId('question-card').first();
  await expect(card.getByTestId('question-text')).toHaveText('How would you design a rate limiter?');
  await expect(card.getByText('Demo answer')).toBeVisible();
  await expect(card.getByTestId('answer-text')).toContainText("Your resume doesn't provide enough detail");
  await expect(page.getByTestId('capture-indicator')).toHaveText(/Practice — microphone off/);

  // Request a different style, then stop.
  await card.getByRole('button', { name: 'STAR' }).click();
  await expect(card.getByText('STAR', { exact: true }).first()).toBeVisible();
  await page.getByTestId('stop-session').click();
  await expect(page.getByTestId('capture-indicator')).toHaveAttribute('data-state', 'idle');
});

test('confirmed profile facts ground the answers', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.getByTestId('nav-profile').click();
  await page.getByText('Or paste resume text').click();
  await page.getByTestId('paste-resume').fill(
    ['Jane Doe', 'Backend Engineer', 'Experience', 'Senior Engineer at Acme 2020 - Present', '- Built Redis rate limiting for the public API', 'Skills', 'Redis, Go'].join('\n'),
  );
  await page.getByTestId('extract-resume').click();
  await expect(page.getByLabel('Name')).toHaveValue('Jane Doe');
  await expect(page.getByTestId('profile-status')).toHaveText('Not confirmed');
  await page.getByTestId('confirm-profile').click();
  await expect(page.getByTestId('profile-status')).toHaveText('Confirmed');

  await page.getByTestId('nav-session').click();
  await page.getByTestId('practice-input').fill('How would you design a rate limiter?');
  await page.getByTestId('practice-ask').click();
  const answer = page.getByTestId('question-card').first().getByTestId('answer-text');
  await expect(answer).toContainText('Redis rate limiting');
  await page.getByTestId('question-card').first().getByTestId('why-answer').click();
  await expect(page.getByTestId('why-panel')).toContainText('E1');
});

test('demo interview is clearly labelled, detects questions without duplicates, and stops', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.getByTestId('demo-toggle').check();
  await page.getByTestId('start-session').click();
  await expect(page.getByTestId('demo-banner')).toHaveText(/Demo data/);
  await expect(page.getByTestId('capture-indicator')).toHaveText(/Demo playing — no audio captured/);
  await expect(page.getByTestId('question-card')).toHaveCount(4, { timeout: 30_000 });
  const questions = await page.getByTestId('question-text').allTextContents();
  expect(new Set(questions).size).toBe(questions.length);
  expect(questions.join(' ')).not.toMatch(/hear me/i);
  await expect(page.getByTestId('transcript')).toContainText('rate limiter');
  await page.keyboard.press('Control+.');
  await expect(page.getByTestId('capture-indicator')).toHaveAttribute('data-state', 'idle');
});

test('permitted assistance requires acknowledgement and captures microphone audio end to end', async () => {
  // Local mock of an OpenAI-compatible transcription endpoint.
  let uploads = 0;
  const server: Server = createServer((req, res) => {
    let size = 0;
    req.on('data', (chunk: Buffer) => (size += chunk.length));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url?.endsWith('/audio/transcriptions')) {
        uploads += 1;
        res.end(JSON.stringify({ text: uploads === 1 ? 'Tell me about a time you resolved a conflict.' : `Audio chunk ${uploads} (${size} bytes).` }));
      } else if (req.url?.endsWith('/models')) {
        res.end(JSON.stringify({ data: [] }));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    launched = await launchApp();
    const { page, userDataDir } = launched;
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('stt-provider').selectOption('openai-whisper');
    const baseUrl = page.getByTestId('stt-base-url');
    await baseUrl.fill(`http://localhost:${port}/v1`);
    await baseUrl.blur();
    await page.getByTestId('transcription-key-input').fill('local-test-key-123456');
    await page.getByTestId('transcription-key-save').click();
    await expect(page.getByTestId('transcription-key-status')).toContainText('…3456');
    await page.getByTestId('transcription-key-test').click();
    await expect(page.getByText('The transcription endpoint accepted the API key.')).toBeVisible();

    await page.getByTestId('nav-session').click();
    await page.getByTestId('mode-assist').click();
    await expect(page.getByTestId('start-session')).toBeDisabled();
    await page.getByTestId('permitted-ack').check();
    await expect(page.getByTestId('consent-panel')).toBeVisible();
    await page.getByTestId('consent-transcription').click();
    await expect(page.getByTestId('consent-panel')).toBeHidden();
    await expect(page.getByTestId('start-session')).toBeEnabled();
    await page.getByTestId('start-session').click();

    await expect(page.getByTestId('capture-indicator')).toHaveText(/^.*Listening/);
    await expect(page.getByRole('meter').first()).toBeVisible();
    await expect(page.getByTestId('transcript')).toContainText('Tell me about a time you resolved a conflict.', { timeout: 30_000 });
    await expect(page.getByTestId('question-card').first().getByTestId('question-text')).toContainText('resolved a conflict');
    await expect(page.getByTestId('question-card').first().getByTestId('answer-text')).toBeVisible();

    await page.getByTestId('pause-session').click();
    await expect(page.getByTestId('capture-indicator')).toHaveText(/Paused/);
    await page.getByTestId('stop-session').click();
    await expect(page.getByTestId('capture-indicator')).toHaveAttribute('data-state', 'idle');
    // Audio is never written to disk and the key never appears in plain text.
    const files = readAllFiles(userDataDir);
    expect(files).not.toContain('local-test-key-123456');
    expect(files).not.toMatch(/RIFF....WAVE/);
  } finally {
    server.close();
  }
});

test('API keys are never shown in the UI and history is opt-in, searchable and deletable', async () => {
  launched = await launchApp();
  const { page, userDataDir } = launched;
  const secret = 'sk-ant-e2e-SECRET-abcdefgh';
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('llm-provider').selectOption('anthropic');
  await page.getByTestId('llm-key-input').fill(secret);
  await page.getByTestId('llm-key-save').click();
  await expect(page.getByTestId('llm-key-status')).toContainText('…efgh');
  expect(await page.content()).not.toContain(secret);
  expect(readAllFiles(userDataDir)).not.toContain(secret);
  await page.getByTestId('llm-provider').selectOption('demo');

  // History is off by default.
  await page.getByTestId('nav-history').click();
  await expect(page.getByText('Session history is off.')).toBeVisible();
  await page.getByRole('button', { name: 'Turn on history' }).click();
  await expect(page.getByText('Session history is off.')).toBeHidden();

  await page.getByTestId('nav-session').click();
  await page.getByTestId('practice-input').fill('Why are you interested in distributed systems?');
  await page.getByTestId('practice-ask').click();
  await expect(page.getByTestId('answer-text').first()).toBeVisible();
  await page.getByTestId('stop-session').click();
  await expect(page.getByTestId('capture-indicator')).toHaveAttribute('data-state', 'idle');

  await page.getByTestId('nav-history').click();
  const list = page.getByTestId('history-list');
  await expect(list.getByRole('button')).toHaveCount(1);
  await page.getByLabel('Search history').fill('distributed');
  await expect(list.getByRole('button')).toHaveCount(1);
  await page.getByLabel('Search history').fill('no-such-thing');
  await expect(list.getByRole('button')).toHaveCount(0);
  await page.getByLabel('Search history').fill('');
  await list.getByRole('button').first().click();
  await expect(page.getByText('Why are you interested in distributed systems?').last()).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('delete-session').click();
  await expect(list.getByRole('button')).toHaveCount(0);
});

test('delete all local data removes keys, profile and settings', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('history-setting').check();
  await page.getByTestId('always-on-top').check();
  await expect(page.getByText(/will appear to others if you share your entire screen/)).toBeVisible();
  const onTop = await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isAlwaysOnTop());
  expect(onTop).toBe(true);

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('delete-all-data').click();
  await expect(page.getByText('All local data was deleted.')).toBeVisible();
  await expect(page.getByTestId('history-setting')).not.toBeChecked();
});
