import type { BuiltContext } from '@shared/core/contextBuilder';
import type {
  AnswerFormat,
  ConnectionTestResult,
  DetectedQuestion,
  ModelAnswer,
  ModelSummary,
  SessionMode,
  TranscriptSegment,
} from '@shared/types';

export interface AnswerRequest {
  question: DetectedQuestion;
  format: AnswerFormat;
  maxWords: number;
  context: BuiltContext;
  signal: AbortSignal;
  /** Chooses the coaching voice: interview candidate or team lead. Defaults to interview. */
  mode?: SessionMode;
}

export interface SummaryRequest {
  /** Bounded "Speaker: text" transcript. */
  transcript: string;
  /** Raw final segments, for offline summarisation. */
  segments: TranscriptSegment[];
  meetingContext?: string;
  signal: AbortSignal;
}

export interface AnswerProvider {
  readonly id: string;
  readonly label: string;
  readonly isDemo: boolean;
  /** Returns a validated answer or throws a ProviderError. */
  generate(request: AnswerRequest): Promise<ModelAnswer>;
  /** Returns a validated meeting summary or throws a ProviderError. */
  summarize(request: SummaryRequest): Promise<ModelSummary>;
  testConnection(): Promise<ConnectionTestResult>;
}
