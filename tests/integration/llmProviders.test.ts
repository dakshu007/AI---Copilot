import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '../../src/main/services/llm/AnthropicProvider';
import { DemoAnswerProvider } from '../../src/main/services/llm/DemoAnswerProvider';
import { OpenAICompatibleProvider, resetOpenAIModeCache } from '../../src/main/services/llm/OpenAICompatibleProvider';
import type { AnswerRequest } from '../../src/main/services/llm/types';
import { buildContext } from '../../src/shared/core/contextBuilder';
import { isAbortError } from '../../src/shared/core/retry';
import { makeJob, makeProfile } from '../fixtures/profiles';

const KEY = 'sk-test-ABCDEFGHIJKLMNOP';
const ANSWER = {
  answer: 'I would use a token bucket keyed by API client, stored in Redis.',
  evidenceUsed: ['E1: Redis-based rate limiting'],
  unsupportedClaims: [],
  insufficientResumeEvidence: false,
  generalExplanation: null,
  followUpQuestion: 'How would you handle bursts?',
  whyThisAnswer: 'You built Redis rate limiting at Acme.',
};

function request(signal = new AbortController().signal): AnswerRequest {
  const question = { id: 'q1', text: 'How would you design a rate limiter?', type: 'technical' as const, confidence: 1, source: 'detected' as const, segmentIds: [], detectedAt: 0 };
  return {
    question,
    format: 'technical',
    maxWords: 120,
    context: buildContext({ profile: makeProfile(), job: makeJob(), question: question.text }),
    signal,
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function anthropicMessage(text: string, stopReason = 'end_turn') {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

describe('AnthropicProvider', () => {
  function make(fetchImpl: typeof fetch, model = 'claude-opus-5-5') {
    const client = new Anthropic({ apiKey: KEY, fetch: fetchImpl, maxRetries: 0 });
    return new AnthropicProvider({ apiKey: KEY, model, effort: 'low', timeoutMs: 10_000, client });
  }

  it('requests structured output with refusal fallbacks and returns a validated answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(anthropicMessage(JSON.stringify(ANSWER))));
    const answer = await make(fetchImpl).generate(request());
    expect(answer).toEqual(ANSWER);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/v1/messages');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.system).toContain('Never invent work history');
    expect(body.output_config.effort).toBe('low');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.required).toEqual(expect.arrayContaining(['answer', 'insufficientResumeEvidence']));
    expect(body.fallbacks).toBe('default');
    expect(body.messages[0].content).toContain('How would you design a rate limiter?');
    expect(body.messages[0].content).not.toContain(KEY);
    const headers = new Headers(init.headers);
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(headers.get('x-api-key') ?? headers.get('authorization')).toContain(KEY);
  });

  it('omits fallbacks for models that do not support them', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(anthropicMessage(JSON.stringify(ANSWER))));
    await make(fetchImpl, 'claude-haiku-5-5').generate(request());
    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body);
    expect(body.fallbacks).toBeUndefined();
    expect(body.output_config.effort).toBe('low');
  });

  it('turns refusals, truncation and bad output into recoverable errors', async () => {
    await expect(make(vi.fn().mockResolvedValue(json(anthropicMessage('', 'refusal')))).generate(request())).rejects.toMatchObject({
      options: { code: 'refusal' },
    });
    await expect(make(vi.fn().mockResolvedValue(json(anthropicMessage('{"answer":', 'max_tokens')))).generate(request())).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('maps HTTP errors without leaking the key', async () => {
    const auth = make(vi.fn().mockResolvedValue(json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401)));
    const error = await auth.generate(request()).catch((e) => e);
    expect(error.options.code).toBe('auth');
    expect(error.message).not.toContain(KEY);

    const limited = make(vi.fn().mockResolvedValue(json({ type: 'error', error: { type: 'rate_limit_error', message: 'slow' } }, 429, { 'retry-after': '2' })));
    await expect(limited.generate(request())).rejects.toMatchObject({ retryable: true, options: { code: 'rate-limit', retryAfterMs: 2_000 } });
  });

  it('supports cancellation', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const pending = make(fetchImpl).generate(request(controller.signal));
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toSatisfy(isAbortError);
  });

  it('tests the connection by looking up the model', async () => {
    const ok = vi.fn().mockResolvedValue(json({ id: 'claude-opus-5-5', type: 'model', display_name: 'Claude', created_at: '2026-01-01T00:00:00Z' }));
    expect(await make(ok).testConnection()).toMatchObject({ ok: true });
    expect(String(ok.mock.calls[0]![0])).toContain('/v1/models/claude-opus-5-5');
    const bad = vi.fn().mockResolvedValue(json({ type: 'error', error: { type: 'not_found_error', message: 'nope' } }, 404));
    expect(await make(bad).testConnection()).toMatchObject({ ok: false });
  });
});

describe('OpenAICompatibleProvider', () => {
  beforeEach(() => resetOpenAIModeCache());

  function make(fetchImpl: typeof fetch) {
    return new OpenAICompatibleProvider({ apiKey: KEY, baseUrl: 'https://api.example.com/v1/', model: 'test-model', timeoutMs: 5_000, fetchImpl });
  }
  const completion = (content: unknown) => json({ choices: [{ message: { content }, finish_reason: 'stop' }] });

  it('uses strict JSON schema output first', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion(JSON.stringify(ANSWER)));
    expect(await make(fetchImpl).generate(request())).toEqual(ANSWER);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[0].role).toBe('system');
  });

  it('falls back to JSON mode, then plain text, for servers without schema support', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'unsupported' }, 400))
      .mockResolvedValueOnce(json({ error: 'unsupported' }, 400))
      .mockResolvedValueOnce(completion(`Here you go:\n\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``))
      .mockResolvedValueOnce(completion(JSON.stringify(ANSWER)));
    const provider = make(fetchImpl);
    expect(await provider.generate(request())).toEqual(ANSWER);
    const modes = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).response_format?.type ?? 'none');
    expect(modes).toEqual(['json_schema', 'json_object', 'none']);
    // The working mode is remembered.
    await provider.generate(request());
    expect(JSON.parse(fetchImpl.mock.calls[3]![1].body).response_format).toBeUndefined();
  });

  it('reports invalid output, refusals and HTTP errors', async () => {
    await expect(make(vi.fn().mockResolvedValue(completion('not json'))).generate(request())).rejects.toMatchObject({
      options: { code: 'invalid-response' },
    });
    await expect(
      make(vi.fn().mockResolvedValue(json({ choices: [{ message: { content: null, refusal: 'no' } }] }))).generate(request()),
    ).rejects.toMatchObject({ options: { code: 'refusal' } });
    await expect(make(vi.fn().mockResolvedValue(json({}, 401))).generate(request())).rejects.toMatchObject({ options: { code: 'auth' } });
    await expect(make(vi.fn().mockResolvedValue(json({}, 500))).generate(request())).rejects.toMatchObject({ retryable: true });
  });

  it('turns network failures into retryable errors without leaking the key', async () => {
    const error = await make(vi.fn().mockRejectedValue(new TypeError(`fetch failed ${KEY}`))).generate(request()).catch((e) => e);
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain(KEY);
  });

  it('tests the connection and warns about unknown models', async () => {
    const result = await make(vi.fn().mockResolvedValue(json({ data: [{ id: 'other-model' }] }))).testConnection();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('was not in');
    expect((await make(vi.fn().mockResolvedValue(json({}, 401))).testConnection()).ok).toBe(false);
  });
});

describe('meeting summaries', () => {
  const SUMMARY = {
    summary: 'The team agreed to ship on Friday.',
    decisions: ['Ship on Friday'],
    actionItems: [{ task: 'Send release notes', owner: 'Alex', due: 'Thursday' }],
    openQuestions: [],
  };
  const summaryRequest = (signal = new AbortController().signal) => ({
    transcript: 'Priya: Can we ship Friday?\nYou: Yes, we will ship Friday.',
    segments: [],
    meetingContext: 'Release checklist',
    signal,
  });

  it('Anthropic summarises with the summary schema', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(anthropicMessage(JSON.stringify(SUMMARY))));
    const client = new Anthropic({ apiKey: KEY, fetch: fetchImpl, maxRetries: 0 });
    const provider = new AnthropicProvider({ apiKey: KEY, model: 'claude-opus-5-5', effort: 'low', timeoutMs: 10_000, client });
    expect(await provider.summarize(summaryRequest())).toEqual(SUMMARY);
    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body);
    expect(body.system).toContain('summarise work meetings');
    expect(body.output_config.format.schema.required).toEqual(['summary', 'decisions', 'actionItems', 'openQuestions']);
    expect(body.messages[0].content).toContain('MEETING NOTES / AGENDA:\nRelease checklist');
  });

  it('Anthropic uses the team-lead prompt in meeting mode', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(anthropicMessage(JSON.stringify(ANSWER))));
    const client = new Anthropic({ apiKey: KEY, fetch: fetchImpl, maxRetries: 0 });
    const provider = new AnthropicProvider({ apiKey: KEY, model: 'claude-opus-5-5', effort: 'low', timeoutMs: 10_000, client });
    await provider.generate({ ...request(), mode: 'meeting', format: 'diplomatic' });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body);
    expect(body.system).toContain('team lead');
    expect(body.messages[0].content).toContain('WHAT THE TEAMMATE SAID');
  });

  it('OpenAI-compatible summarises and rejects malformed summaries', async () => {
    resetOpenAIModeCache();
    const completion = (content: unknown) => json({ choices: [{ message: { content } }] });
    const ok = new OpenAICompatibleProvider({ apiKey: KEY, baseUrl: 'https://api.example.com/v1', model: 'm', timeoutMs: 5_000, fetchImpl: vi.fn().mockResolvedValue(completion(JSON.stringify(SUMMARY))) });
    expect(await ok.summarize(summaryRequest())).toEqual(SUMMARY);
    const bad = new OpenAICompatibleProvider({ apiKey: KEY, baseUrl: 'https://api.example.com/v1', model: 'm', timeoutMs: 5_000, fetchImpl: vi.fn().mockResolvedValue(completion('{"summary": ""}')) });
    await expect(bad.summarize(summaryRequest())).rejects.toMatchObject({ options: { code: 'invalid-response' } });
  });
});

describe('DemoAnswerProvider', () => {
  it('answers offline from profile facts and can be cancelled', async () => {
    const provider = new DemoAnswerProvider(5);
    const answer = await provider.generate(request());
    expect(answer.answer).toMatch(/rate limiting/i);
    const controller = new AbortController();
    controller.abort();
    await expect(new DemoAnswerProvider(50).generate(request(controller.signal))).rejects.toSatisfy(isAbortError);
    expect((await provider.testConnection()).ok).toBe(true);
  });
});
