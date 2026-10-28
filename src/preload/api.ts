import type {
  AnswerFormat,
  CandidateProfile,
  ConnectionTestResult,
  JobContext,
  PlatformInfo,
  PublicSettings,
  ResumeImportResult,
  SecretKind,
  SecretStatus,
  SessionEvent,
  SessionRecord,
  SessionSnapshot,
  SessionSummary,
  Settings,
  SettingsUpdate,
  StartSessionRequest,
} from '@shared/types';

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** The only API the renderer can use. Exposed as `window.copilot`. */
export interface CopilotApi {
  settings: {
    get(): Promise<IpcResult<PublicSettings>>;
    update(update: SettingsUpdate): Promise<IpcResult<Settings>>;
    setSecret(kind: SecretKind, value: string): Promise<IpcResult<SecretStatus>>;
    clearSecret(kind: SecretKind): Promise<IpcResult<SecretStatus>>;
    testLlm(): Promise<IpcResult<ConnectionTestResult>>;
    testTranscription(): Promise<IpcResult<ConnectionTestResult>>;
  };
  profile: {
    get(): Promise<IpcResult<CandidateProfile | null>>;
    save(profile: CandidateProfile): Promise<IpcResult<CandidateProfile>>;
    /** Opens a native file picker in the main process. Resolves to null if cancelled. */
    importFile(): Promise<IpcResult<ResumeImportResult | null>>;
    importBytes(fileName: string, bytes: Uint8Array): Promise<IpcResult<ResumeImportResult>>;
    extractFromText(text: string): Promise<IpcResult<ResumeImportResult>>;
    delete(): Promise<IpcResult<void>>;
  };
  job: {
    get(): Promise<IpcResult<JobContext | null>>;
    save(job: JobContext): Promise<IpcResult<JobContext>>;
    analyze(text: string): Promise<IpcResult<JobContext>>;
    delete(): Promise<IpcResult<void>>;
  };
  session: {
    start(request: StartSessionRequest): Promise<IpcResult<void>>;
    pause(): Promise<IpcResult<void>>;
    resume(): Promise<IpcResult<void>>;
    stop(): Promise<IpcResult<void>>;
    snapshot(): Promise<IpcResult<SessionSnapshot>>;
    /** Fire-and-forget PCM frame (interleaved Int16). */
    sendAudio(frame: Int16Array): void;
    markQuestion(text: string, segmentIds?: string[], source?: 'manual' | 'practice'): Promise<IpcResult<void>>;
    generate(questionId: string, format?: AnswerFormat): Promise<IpcResult<void>>;
    cancel(questionId: string): Promise<IpcResult<void>>;
    feedback(questionId: string, createdAt: number, feedback: 'useful' | 'not-useful'): Promise<IpcResult<void>>;
    /** Summarise the current or just-finished meeting; the result arrives as a session event. */
    summarize(): Promise<IpcResult<void>>;
    onEvent(listener: (event: SessionEvent) => void): () => void;
  };
  history: {
    list(query?: string): Promise<IpcResult<SessionSummary[]>>;
    get(id: string): Promise<IpcResult<SessionRecord | null>>;
    delete(id: string): Promise<IpcResult<void>>;
    deleteAll(): Promise<IpcResult<void>>;
    export(id: string, format: 'md' | 'txt'): Promise<IpcResult<string | null>>;
  };
  privacy: {
    deleteAllData(): Promise<IpcResult<void>>;
  };
  app: {
    info(): Promise<IpcResult<PlatformInfo>>;
    openExternal(url: string): Promise<IpcResult<void>>;
    requestMicrophone(): Promise<IpcResult<'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'>>;
    openPrivacySettings(pane: 'microphone' | 'screen'): Promise<IpcResult<void>>;
    /** Open or close the separate answer window. Resolves to its new open state. */
    toggleOverlay(): Promise<IpcResult<boolean>>;
    overlayState(): Promise<IpcResult<boolean>>;
  };
}
