import type { z } from 'zod';
import type {
  AnswerFormatSchema,
  ActionItemSchema,
  AnswerSuggestionSchema,
  CommunicationInsightsSchema,
  MeetingSummarySchema,
  ModelSummarySchema,
  AudioSourceSchema,
  CandidateProfileSchema,
  DetectedQuestionSchema,
  ExperienceSchema,
  JobContextSchema,
  LlmProviderIdSchema,
  ModelAnswerSchema,
  ProjectSchema,
  QuestionTypeSchema,
  SecretKindSchema,
  SessionModeSchema,
  SessionRecordSchema,
  SessionStateSchema,
  SessionSummarySchema,
  SettingsSchema,
  SpeakerRoleSchema,
  TranscriptSegmentSchema,
  TranscriptionProviderIdSchema,
} from '../schemas';

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type SpeakerRole = z.infer<typeof SpeakerRoleSchema>;
export type AnswerFormat = z.infer<typeof AnswerFormatSchema>;
export type QuestionType = z.infer<typeof QuestionTypeSchema>;
export type DetectedQuestion = z.infer<typeof DetectedQuestionSchema>;
export type AnswerSuggestion = z.infer<typeof AnswerSuggestionSchema>;
export type ModelAnswer = z.infer<typeof ModelAnswerSchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;
export type SessionMode = z.infer<typeof SessionModeSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsUpdate = { [Section in Exclude<keyof Settings, 'version'>]?: Partial<Settings[Section]> };
export type SecretKind = z.infer<typeof SecretKindSchema>;
export type LlmProviderId = z.infer<typeof LlmProviderIdSchema>;
export type TranscriptionProviderId = z.infer<typeof TranscriptionProviderIdSchema>;
export type AudioSource = z.infer<typeof AudioSourceSchema>;
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type JobContext = z.infer<typeof JobContextSchema>;
export type SessionRecord = z.infer<typeof SessionRecordSchema>;
export type ActionItem = z.infer<typeof ActionItemSchema>;
export type ModelSummary = z.infer<typeof ModelSummarySchema>;
export type MeetingSummary = z.infer<typeof MeetingSummarySchema>;
export type CommunicationInsights = z.infer<typeof CommunicationInsightsSchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export type TranscriptionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface SecretStatus {
  set: boolean;
  /** Last four characters only, so the user can recognise which key is stored. */
  hint: string;
  /** `persisted` = encrypted with the OS keychain; `memory` = kept only until the app quits. */
  storage: 'persisted' | 'memory' | 'none';
}

export interface PublicSettings {
  settings: Settings;
  secrets: Record<SecretKind, SecretStatus>;
  secureStorage: { available: boolean; backend: string };
}

export interface PlatformInfo {
  platform: NodeJS.Platform | 'unknown';
  arch: string;
  version: string;
  isPackaged: boolean;
  systemAudio: SystemAudioSupport;
}

export interface SystemAudioSupport {
  supported: boolean;
  method: 'loopback' | 'virtual-device-only';
  note: string;
}

export interface ResumeImportResult {
  fileName: string;
  text: string;
  profile: CandidateProfile;
  warnings: string[];
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export interface StartSessionRequest {
  mode: SessionMode;
  /** Number of interleaved audio channels the renderer will send (0 = no audio). */
  audioChannels: 0 | 1 | 2;
  sampleRate: number;
  /** Optional speaker label for each channel, e.g. ['You', 'Interviewer']. */
  channelLabels?: string[];
  demo: boolean;
  /** assist: the organizer permits AI help; meeting: participants know it is transcribed. */
  permittedAcknowledged: boolean;
  /** Optional agenda / project notes for team meetings (kept in memory for the session). */
  meetingContext?: string;
}

export type SessionEvent =
  | {
      type: 'state';
      state: SessionState;
      mode: SessionMode | null;
      isDemo: boolean;
      sessionId: string | null;
      message?: string;
    }
  | { type: 'segment'; segment: TranscriptSegment }
  | { type: 'question'; question: DetectedQuestion }
  | { type: 'answer-start'; questionId: string; format: AnswerFormat }
  | { type: 'answer'; suggestion: AnswerSuggestion }
  | { type: 'answer-error'; questionId: string; message: string; retryable: boolean }
  | { type: 'answer-cancelled'; questionId: string }
  | { type: 'transcription-status'; status: TranscriptionStatus; message?: string }
  | { type: 'summary-start' }
  | { type: 'summary'; summary: MeetingSummary }
  | { type: 'summary-error'; message: string }
  | { type: 'overlay-state'; open: boolean }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; message: string };

export interface SessionSnapshot {
  state: SessionState;
  mode: SessionMode | null;
  isDemo: boolean;
  sessionId: string | null;
  segments: TranscriptSegment[];
  questions: DetectedQuestion[];
  answers: AnswerSuggestion[];
  summary?: MeetingSummary;
  message?: string;
}

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };
