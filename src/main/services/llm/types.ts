import type { BuiltContext } from '@shared/core/contextBuilder';
import type { AnswerFormat, ConnectionTestResult, DetectedQuestion, ModelAnswer } from '@shared/types';

export interface AnswerRequest {
  question: DetectedQuestion;
  format: AnswerFormat;
  maxWords: number;
  context: BuiltContext;
  signal: AbortSignal;
}

export interface AnswerProvider {
  readonly id: string;
  readonly label: string;
  readonly isDemo: boolean;
  /** Returns a validated answer or throws a ProviderError. */
  generate(request: AnswerRequest): Promise<ModelAnswer>;
  testConnection(): Promise<ConnectionTestResult>;
}
