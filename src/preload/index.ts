import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type { SessionEvent } from '@shared/types';
import type { CopilotApi } from './api';

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;

/**
 * A narrow, typed bridge. The renderer never gets `ipcRenderer`, Node APIs or API keys.
 */
const api: CopilotApi = {
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (update) => invoke(IPC.settingsUpdate, update),
    setSecret: (kind, value) => invoke(IPC.secretSet, { kind, value }),
    clearSecret: (kind) => invoke(IPC.secretClear, kind),
    testLlm: () => invoke(IPC.testLlm),
    testTranscription: () => invoke(IPC.testTranscription),
  },
  profile: {
    get: () => invoke(IPC.profileGet),
    save: (profile) => invoke(IPC.profileSave, profile),
    importFile: () => invoke(IPC.profileImport),
    importBytes: (fileName, bytes) => invoke(IPC.profileImportBytes, { fileName, bytes }),
    extractFromText: (text) => invoke(IPC.profileExtractText, text),
    delete: () => invoke(IPC.profileDelete),
  },
  job: {
    get: () => invoke(IPC.jobGet),
    save: (job) => invoke(IPC.jobSave, job),
    analyze: (text) => invoke(IPC.jobAnalyze, text),
    delete: () => invoke(IPC.jobDelete),
  },
  session: {
    start: (request) => invoke(IPC.sessionStart, request),
    pause: () => invoke(IPC.sessionPause),
    resume: () => invoke(IPC.sessionResume),
    stop: () => invoke(IPC.sessionStop),
    snapshot: () => invoke(IPC.sessionSnapshot),
    sendAudio: (frame) => ipcRenderer.send(IPC.sessionAudio, frame),
    markQuestion: (text, segmentIds = [], source = 'manual') =>
      invoke(IPC.sessionMarkQuestion, { text, segmentIds, source }),
    generate: (questionId, format) => invoke(IPC.sessionGenerate, { questionId, format }),
    cancel: (questionId) => invoke(IPC.sessionCancel, questionId),
    feedback: (questionId, createdAt, feedback) => invoke(IPC.sessionFeedback, { questionId, createdAt, feedback }),
    summarize: () => invoke(IPC.sessionSummarize),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SessionEvent) => listener(payload);
      ipcRenderer.on(IPC.sessionEvent, handler);
      return () => ipcRenderer.removeListener(IPC.sessionEvent, handler);
    },
  },
  history: {
    list: (query = '') => invoke(IPC.historyList, query),
    get: (id) => invoke(IPC.historyGet, id),
    delete: (id) => invoke(IPC.historyDelete, id),
    deleteAll: () => invoke(IPC.historyDeleteAll),
    export: (id, format) => invoke(IPC.historyExport, { id, format }),
  },
  privacy: {
    deleteAllData: () => invoke(IPC.privacyDeleteAll),
  },
  app: {
    info: () => invoke(IPC.appInfo),
    openExternal: (url) => invoke(IPC.appOpenExternal, url),
    requestMicrophone: () => invoke(IPC.appRequestMicrophone),
    openPrivacySettings: (pane) => invoke(IPC.appOpenPrivacySettings, pane),
    toggleOverlay: () => invoke(IPC.appToggleOverlay),
    overlayState: () => invoke(IPC.appOverlayState),
  },
};

contextBridge.exposeInMainWorld('copilot', api);
