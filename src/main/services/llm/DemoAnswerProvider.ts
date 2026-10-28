import { generateDemoAnswer } from '@shared/core/demoAnswer';
import { generateLocalSummary } from '@shared/core/localSummary';
import { sleep } from '@shared/core/retry';
import type { ConnectionTestResult, ModelAnswer, ModelSummary } from '@shared/types';
import type { AnswerProvider, AnswerRequest, SummaryRequest } from './types';

/** Offline answers built only from the user's own facts and notes. Labelled as demo in the UI. */
export class DemoAnswerProvider implements AnswerProvider {
  readonly id = 'demo';
  readonly label = 'Demo (offline, no AI)';
  readonly isDemo = true;

  constructor(private readonly latencyMs = 450) {}

  async generate(request: AnswerRequest): Promise<ModelAnswer> {
    await sleep(this.latencyMs, request.signal);
    return generateDemoAnswer({
      question: request.question.text,
      questionType: request.question.type,
      format: request.format,
      context: request.context,
      mode: request.mode,
    });
  }

  async summarize(request: SummaryRequest): Promise<ModelSummary> {
    await sleep(this.latencyMs, request.signal);
    return generateLocalSummary(request.segments);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, message: 'Demo answers run offline and need no API key.' };
  }
}
