import Anthropic from '@anthropic-ai/sdk';
import { parseModelAnswer } from '@shared/core/answerParser';
import { MODEL_ANSWER_JSON_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from '@shared/core/prompt';
import { ProviderError, errorFromStatus, redactSecrets } from '@shared/core/retry';
import type { ConnectionTestResult, ModelAnswer } from '@shared/types';
import type { AnswerProvider, AnswerRequest } from './types';

/** Models that accept `output_config.effort`. */
const EFFORT_MODELS = /^claude-(fable|mythos|opus|sonnet|haiku)-5|^claude-opus-4-[5-8]|^claude-sonnet-4-6/;
/** Models that accept server-side refusal fallbacks in the "default" form. */
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
  timeoutMs: number;
  /** Test hook. */
  client?: Anthropic;
}

export class AnthropicProvider implements AnswerProvider {
  readonly id = 'anthropic';
  readonly isDemo = false;
  readonly label: string;
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicOptions) {
    this.label = `Claude (${options.model})`;
    // Retries are handled by the session controller so they stay bounded and cancellable.
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 0, timeout: options.timeoutMs });
  }

  async generate(request: AnswerRequest): Promise<ModelAnswer> {
    const model = this.options.model;
    const useFallbacks = FALLBACK_MODELS.test(model);
    try {
      const response = await this.client.beta.messages.create(
        {
          model,
          max_tokens: 8_000,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: buildUserPrompt({
                question: request.question.text,
                questionType: request.question.type,
                format: request.format,
                maxWords: request.maxWords,
                context: request.context,
              }),
            },
          ],
          output_config: {
            ...(EFFORT_MODELS.test(model) ? { effort: this.options.effort } : {}),
            // Structured outputs: the response text is constrained to this JSON schema.
            format: { type: 'json_schema', schema: MODEL_ANSWER_JSON_SCHEMA as unknown as Record<string, unknown> },
          },
          ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { signal: request.signal, timeout: this.options.timeoutMs },
      );

      if (response.stop_reason === 'refusal') {
        throw new ProviderError('Claude declined to answer this question. Try rephrasing it.', { code: 'refusal' });
      }
      if (response.stop_reason === 'max_tokens') {
        throw new ProviderError('The answer was cut off. Try again or shorten the answer length.', {
          code: 'invalid-response',
          retryable: true,
        });
      }
      // Validate before display: never trust the shape of model output.
      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');
      const parsed = parseModelAnswer(text);
      if (!parsed.ok) throw new ProviderError(parsed.error, { code: 'invalid-response', retryable: true });
      return parsed.value;
    } catch (error) {
      throw this.toProviderError(error);
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      await this.client.models.retrieve(this.options.model, {}, { timeout: 10_000 });
      return { ok: true, message: `Connected. Model ${this.options.model} is available.`, latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, message: this.toProviderError(error).message };
    }
  }

  private toProviderError(error: unknown): ProviderError {
    if (error instanceof ProviderError) return error;
    if (error instanceof Anthropic.APIUserAbortError) return new ProviderError('Cancelled', { code: 'cancelled' });
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return new ProviderError('Claude took too long to respond.', { code: 'timeout', retryable: true });
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return new ProviderError('Could not reach the Anthropic API. Check your internet connection.', {
        code: 'network',
        retryable: true,
      });
    }
    if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
      const mapped = errorFromStatus(error.status, 'Anthropic', error.headers?.get?.('retry-after') ?? null);
      if (error.status === 400) {
        return new ProviderError(
          redactSecrets(`Anthropic rejected the request: ${error.message}`, [this.options.apiKey]).slice(0, 300),
          { status: 400, code: 'config' },
        );
      }
      return mapped;
    }
    return new ProviderError(
      redactSecrets(`Unexpected error from Anthropic: ${(error as Error)?.message ?? 'unknown'}`, [this.options.apiKey]),
      { code: 'server' },
    );
  }
}
