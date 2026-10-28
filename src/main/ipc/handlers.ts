import { promises as fs } from 'node:fs';
import { basename } from 'node:path';
import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { sessionToMarkdown, sessionToText } from '@shared/core/exporter';
import { analyzeJobDescription } from '@shared/core/jobAnalyzer';
import { extractProfile } from '@shared/core/profileExtractor';
import { redactSecrets } from '@shared/core/retry';
import {
  ExportSchema,
  ExternalUrlSchema,
  FeedbackSchema,
  GenerateSchema,
  IPC,
  ImportBytesSchema,
  MAX_AUDIO_FRAME_BYTES,
  MarkQuestionSchema,
  SecretSetSchema,
  SessionIdSchema,
  StartSessionSchema,
} from '@shared/ipc';
import { CandidateProfileSchema, JobContextSchema, SecretKindSchema } from '@shared/schemas';
import type { PlatformInfo } from '@shared/types';
import type { IpcResult } from '../../preload/api';
import { isTrustedOrigin } from '../security';
import { MAC_PRIVACY_URLS, requestMicrophoneAccess, systemAudioSupport } from '../services/audio/systemAudio';
import { createAnswerProvider, createTranscriptionProvider } from '../services/providerFactory';
import { MAX_RESUME_BYTES, parseResume } from '../services/resume/ResumeParser';
import type { SessionController } from '../services/session/SessionController';
import type { HistoryStore } from '../services/storage/HistoryStore';
import type { PrivacyController } from '../services/storage/PrivacyController';
import type { ProfileStore } from '../services/storage/ProfileStore';
import type { SecureSettingsService } from '../services/storage/SecureSettingsService';

export interface IpcDeps {
  getWindow(): BrowserWindow | null;
  settings: SecureSettingsService;
  profiles: ProfileStore;
  history: HistoryStore;
  privacy: PrivacyController;
  session: SessionController;
  devServerUrl?: string;
}

function messageFor(error: unknown, secrets: Array<string | undefined>): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => issue.message).join('; ') || 'Invalid input.';
  }
  const message = error instanceof Error ? error.message : 'Unexpected error.';
  return redactSecrets(message, secrets);
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const secrets = () => [deps.settings.getSecret('llm'), deps.settings.getSecret('transcription')];

  /** Every handler: verify the sender, validate input, never throw raw errors across IPC. */
  const handle = <T>(channel: string, fn: (event: IpcMainInvokeEvent, payload: unknown) => Promise<T> | T) => {
    ipcMain.handle(channel, async (event, payload: unknown): Promise<IpcResult<T>> => {
      if (!isTrustedOrigin(event.senderFrame?.url ?? '', deps.devServerUrl)) {
        return { ok: false, error: 'Untrusted sender.' };
      }
      try {
        return { ok: true, value: await fn(event, payload) };
      } catch (error) {
        return { ok: false, error: messageFor(error, secrets()) };
      }
    });
  };

  // Settings and secrets
  handle(IPC.settingsGet, () => deps.settings.getPublic());
  handle(IPC.settingsUpdate, async (_e, payload) => {
    const updated = await deps.settings.update(payload);
    deps.session.invalidateProviders();
    const window = deps.getWindow();
    if (window && !window.isDestroyed()) window.setAlwaysOnTop(updated.ui.alwaysOnTop, 'floating');
    return updated;
  });
  handle(IPC.secretSet, async (_e, payload) => {
    const { kind, value } = SecretSetSchema.parse(payload);
    const status = await deps.settings.setSecret(kind, value);
    deps.session.invalidateProviders();
    return status;
  });
  handle(IPC.secretClear, async (_e, payload) => {
    const status = await deps.settings.clearSecret(SecretKindSchema.parse(payload));
    deps.session.invalidateProviders();
    return status;
  });
  handle(IPC.testLlm, () => createAnswerProvider(deps.settings).testConnection());
  handle(IPC.testTranscription, () => createTranscriptionProvider(deps.settings).testConnection());

  // Profile and job description
  handle(IPC.profileGet, () => deps.profiles.getProfile());
  handle(IPC.profileSave, (_e, payload) => deps.profiles.saveProfile(CandidateProfileSchema.parse(payload)));
  handle(IPC.profileDelete, () => deps.profiles.deleteProfile());
  handle(IPC.profileImport, async () => {
    const window = deps.getWindow();
    const options: Electron.OpenDialogOptions = {
      title: 'Import resume',
      properties: ['openFile'],
      filters: [{ name: 'Resume', extensions: ['pdf', 'docx', 'txt', 'md'] }],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_RESUME_BYTES) throw new Error('The file is larger than 10 MB.');
    return parseResume(basename(filePath), new Uint8Array(await fs.readFile(filePath)));
  });
  handle(IPC.profileImportBytes, (_e, payload) => {
    const { fileName, bytes } = ImportBytesSchema.parse(payload);
    return parseResume(fileName, bytes);
  });
  handle(IPC.profileExtractText, (_e, payload) => {
    const text = z.string().min(30, 'Paste at least a few lines of your resume.').max(200_000).parse(payload);
    const { profile, warnings } = extractProfile(text, 'Pasted text');
    return { fileName: 'Pasted text', text, profile, warnings };
  });
  handle(IPC.jobGet, () => deps.profiles.getJob());
  handle(IPC.jobSave, (_e, payload) => deps.profiles.saveJob(JobContextSchema.parse(payload)));
  handle(IPC.jobAnalyze, (_e, payload) => analyzeJobDescription(z.string().max(100_000).parse(payload)));
  handle(IPC.jobDelete, () => deps.profiles.deleteJob());

  // Session
  handle(IPC.sessionStart, (_e, payload) => deps.session.start(StartSessionSchema.parse(payload)));
  handle(IPC.sessionPause, () => deps.session.pause());
  handle(IPC.sessionResume, () => deps.session.resume());
  handle(IPC.sessionStop, () => deps.session.stop());
  handle(IPC.sessionSnapshot, () => deps.session.snapshot());
  handle(IPC.sessionMarkQuestion, (_e, payload) => {
    const { text, segmentIds, source } = MarkQuestionSchema.parse(payload);
    deps.session.markQuestion(text, segmentIds, source);
  });
  handle(IPC.sessionGenerate, (_e, payload) => {
    const { questionId, format } = GenerateSchema.parse(payload);
    void deps.session.generateAnswer(questionId, format);
  });
  handle(IPC.sessionCancel, (_e, payload) => deps.session.cancelAnswer(z.string().max(128).parse(payload)));
  handle(IPC.sessionFeedback, (_e, payload) => {
    const { questionId, createdAt, feedback } = FeedbackSchema.parse(payload);
    deps.session.setFeedback(questionId, createdAt, feedback);
  });

  // Audio frames are high-frequency, so they use `send` instead of `invoke`.
  ipcMain.on(IPC.sessionAudio, (event, frame: unknown) => {
    if (!isTrustedOrigin(event.senderFrame?.url ?? '', deps.devServerUrl)) return;
    if (!(frame instanceof Int16Array) || frame.byteLength === 0 || frame.byteLength > MAX_AUDIO_FRAME_BYTES) return;
    deps.session.ingestAudio(frame);
  });

  // History
  handle(IPC.historyList, (_e, payload) => deps.history.list(z.string().max(200).parse(payload ?? '')));
  handle(IPC.historyGet, (_e, payload) => deps.history.get(SessionIdSchema.parse(payload)));
  handle(IPC.historyDelete, (_e, payload) => deps.history.delete(SessionIdSchema.parse(payload)));
  handle(IPC.historyDeleteAll, () => deps.history.deleteAll());
  handle(IPC.historyExport, async (_e, payload) => {
    const { id, format } = ExportSchema.parse(payload);
    const record = await deps.history.get(id);
    if (!record) throw new Error('Session not found.');
    const window = deps.getWindow();
    const options: Electron.SaveDialogOptions = {
      title: 'Export session',
      defaultPath: `interview-session-${new Date(record.startedAt).toISOString().slice(0, 10)}.${format}`,
      filters: [{ name: format === 'md' ? 'Markdown' : 'Text', extensions: [format] }],
    };
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, format === 'md' ? sessionToMarkdown(record) : sessionToText(record), 'utf8');
    return result.filePath;
  });

  // Privacy
  handle(IPC.privacyDeleteAll, async () => {
    await deps.session.stop();
    await deps.privacy.deleteAllData();
    deps.session.invalidateProviders();
  });

  // App
  handle(IPC.appInfo, (): PlatformInfo => ({
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    systemAudio: systemAudioSupport(),
  }));
  handle(IPC.appOpenExternal, async (_e, payload) => {
    await shell.openExternal(ExternalUrlSchema.parse(payload));
  });
  handle(IPC.appRequestMicrophone, () => requestMicrophoneAccess());
  handle(IPC.appOpenPrivacySettings, async (_e, payload) => {
    const pane = z.enum(['microphone', 'screen']).parse(payload);
    if (process.platform === 'darwin') await shell.openExternal(MAC_PRIVACY_URLS[pane]);
  });
}
