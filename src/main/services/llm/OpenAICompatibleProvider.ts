import { parseModelAnswer, parseModelSummary } from '@shared/core/answerParser';
import {
  MODEL_ANSWER_JSON_SCHEMA,
  MODEL_SUMMARY_JSON_SCHEMA,
  SUMMARY_SYSTEM_PROMPT,
  buildSummaryPrompt,
  buildUserPrompt,
  systemPromptFor,
} from '@shared/core/prompt';
import { ProviderError, errorFromStatus, isAbortError, redactSecrets } from '@shared/core/retry';
import type { ConnectionTestResult, ModelAnswer, ModelSummary, Result } from '@shared/types';
import type { AnswerProvider, AnswerRequest, SummaryRequest } from './types';

export interface OpenAICompatibleOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

type ResponseMode = 'json_schema' | 'json_object' | 'none';

/** Remember which structured-output mode each endpoint+model supports. */
const supportedMode = new Map<string, ResponseMode>();

interface StructuredCall<T> {
  system: string;
  user: string;
  schemaName: string;
  schema: object;
  parse: (raw: unknown) => Result<T>;
  signal: AbortSignal;
}

/**
 * Chat Completions-compatible provider (OpenAI, Azure OpenAI-compatible gateways, Groq,
 * OpenRouter, Ollama, LM Studio…). Tries strict JSON schema output first and degrades to
 * JSON mode, then to defensive parsing, for servers that do not support it.
 */
export class OpenAICompatibleProvider implements AnswerProvider {
  readonly id = 'openai-compatible';
  readonly isDemo = false;
  readonly label: string;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.label = `OpenAI-compatible (${options.model})`;
  }

  private get endpoint(): string {
    return this.options.baseUrl.replace(/\/+$/, '');
  }

  generate(request: AnswerRequest): Promise<ModelAnswer> {
    return this.structured({
      system: systemPromptFor(request.mode),
      user: buildUserPrompt({
        question: request.question.text,
        questionType: request.question.type,
        format: request.format,
        maxWords: request.maxWords,
        context: request.context,
        mode: request.mode,
      }),
      schemaName: 'interview_answer',
      schema: MODEL_ANSWER_JSON_SCHEMA,
      parse: parseModelAnswer,
      signal: request.signal,
    });
  }

  summarize(request: SummaryRequest): Promise<ModelSummary> {
    return this.structured({
      system: SUMMARY_SYSTEM_PROMPT,
      user: buildSummaryPrompt({ transcript: request.transcript, meetingContext: request.meetingContext }),
      schemaName: 'meeting_summary',
      schema: MODEL_SUMMARY_JSON_SCHEMA,
      parse: parseModelSummary,
      signal: request.signal,
    });
  }

  private async structured<T>(call: StructuredCall<T>): Promise<T> {
    const key = `${this.endpoint}|${this.options.model}`;
    const modes: ResponseMode[] = ['json_schema', 'json_object', 'none'];
    let mode = supportedMode.get(key) ?? 'json_schema';
    for (;;) {
      try {
        const result = await this.call(call, mode);
        supportedMode.set(key, mode);
        return result;
      } catch (error) {
        const next = modes[modes.indexOf(mode) + 1];
        if (error instanceof ProviderError && error.options.status === 400 && next) {
          mode = next;
          continue;
        }
        throw error;
      }
    }
  }

  private async call<T>(call: StructuredCall<T>, mode: ResponseMode): Promise<T> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const body: Record<string, unknown> = {
      model: this.options.model,
      messages: [
        { role: 'system', content: call.system },
        { role: 'user', content: call.user },
      ],
    };
    if (mode === 'json_schema') {
      body.response_format = { type: 'json_schema', json_schema: { name: call.schemaName, strict: true, schema: call.schema } };
    } else if (mode === 'json_object') {
      body.response_format = { type: 'json_object' };
    }

    let response: Response;
    try {
      response = await fetchImpl(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.any([call.signal, AbortSignal.timeout(this.options.timeoutMs)]),
      });
    } catch (error) {
      if (call.signal.aborted) throw new ProviderError('Cancelled', { code: 'cancelled' });
      if (isAbortError(error) || (error as Error)?.name === 'TimeoutError') {
        throw new ProviderError('The AI provider took too long to respond.', { code: 'timeout', retryable: true });
      }
      throw new ProviderError(
        redactSecrets(`Could not reach the AI provider: ${(error as Error)?.message ?? 'network error'}`, [this.options.apiKey]),
        { code: 'network', retryable: true },
      );
    }

    if (!response.ok) {
      throw errorFromStatus(response.status, 'The AI provider', response.headers.get('retry-after'));
    }
    const payload = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: unknown; refusal?: unknown }; finish_reason?: string }>;
    } | null;
    const choice = payload?.choices?.[0];
    if (typeof choice?.message?.refusal === 'string' && choice.message.refusal) {
      throw new ProviderError('The AI provider declined this request.', { code: 'refusal' });
    }
    const content = choice?.message?.content;
    if (typeof content !== 'string') {
      throw new ProviderError('The AI provider returned an empty response.', { code: 'invalid-response', retryable: true });
    }
    const parsed = call.parse(content);
    if (!parsed.ok) throw new ProviderError(parsed.error, { code: 'invalid-response', retryable: true });
    return parsed.value;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const started = Date.now();
    try {
      const response = await fetchImpl(`${this.endpoint}/models`, {
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return { ok: false, message: errorFromStatus(response.status, 'The AI provider').message };
      const body = (await response.json().catch(() => null)) as { data?: Array<{ id?: string }> } | null;
      const ids = body?.data?.map((m) => m.id).filter(Boolean) ?? [];
      const known = ids.length === 0 || ids.includes(this.options.model);
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: known
          ? 'Connected to the AI provider.'
          : `Connected, but model "${this.options.model}" was not in the provider's model list.`,
      };
    } catch (error) {
      return {
        ok: false,
        message: redactSecrets(`Could not reach the AI provider: ${(error as Error).message}`, [this.options.apiKey]),
      };
    }
  }
}

/** Test helper. */
export function resetOpenAIModeCache(): void {
  supportedMode.clear();
}
