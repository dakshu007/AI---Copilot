import { ModelAnswerSchema, ModelSummarySchema } from '../schemas';
import type { AnswerFormat, AnswerSuggestion, ModelAnswer, ModelSummary, Result, SessionMode } from '../types';
import { insufficientSentenceFor } from './prompt';

/** Pull the first balanced JSON object out of a model response (handles ``` fences and prose). */
export function extractJsonObject(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1] ?? raw;
  const start = source.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse and validate untrusted model output. Never throws. */
export function parseModelAnswer(raw: unknown): Result<ModelAnswer> {
  let candidate: unknown = raw;
  if (typeof raw === 'string') {
    const json = extractJsonObject(raw);
    if (!json) return { ok: false, error: 'The AI response did not contain a JSON answer.' };
    try {
      candidate = JSON.parse(json);
    } catch {
      return { ok: false, error: 'The AI response contained malformed JSON.' };
    }
  }
  if (candidate && typeof candidate === 'object') {
    // Be lenient with providers that omit nullable keys or return null arrays.
    const value = candidate as Record<string, unknown>;
    candidate = {
      ...value,
      evidenceUsed: Array.isArray(value.evidenceUsed) ? value.evidenceUsed : [],
      unsupportedClaims: Array.isArray(value.unsupportedClaims) ? value.unsupportedClaims : [],
      insufficientResumeEvidence: Boolean(value.insufficientResumeEvidence),
      generalExplanation: typeof value.generalExplanation === 'string' ? value.generalExplanation : null,
      followUpQuestion: typeof value.followUpQuestion === 'string' ? value.followUpQuestion : null,
      whyThisAnswer: typeof value.whyThisAnswer === 'string' ? value.whyThisAnswer : '',
    };
  }
  const parsed = ModelAnswerSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: 'The AI response did not match the expected answer format.' };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Convert a validated model answer into a suggestion and enforce the grounding contract: if
 * the model flags missing evidence, the answer must say so explicitly.
 */
export function toSuggestion(params: {
  model: ModelAnswer;
  questionId: string;
  format: AnswerFormat;
  provider: string;
  isDemo?: boolean;
  now?: number;
  mode?: SessionMode;
}): AnswerSuggestion {
  const { model } = params;
  let answer = model.answer.trim();
  const disclaimer = insufficientSentenceFor(params.mode);
  if (model.insufficientResumeEvidence && !answer.toLowerCase().includes(disclaimer.toLowerCase())) {
    answer = `${disclaimer}. ${answer}`;
  }
  const clean = (items: string[]) => items.map((s) => s.trim()).filter(Boolean).slice(0, 12);
  return {
    questionId: params.questionId,
    answer,
    format: params.format,
    evidenceUsed: clean(model.evidenceUsed),
    unsupportedClaims: clean(model.unsupportedClaims),
    followUpQuestion: model.followUpQuestion?.trim() || undefined,
    generalExplanation: model.generalExplanation?.trim() || undefined,
    insufficientEvidence: model.insufficientResumeEvidence,
    whyThisAnswer: model.whyThisAnswer.trim(),
    provider: params.provider,
    isDemo: params.isDemo ?? false,
    createdAt: params.now ?? Date.now(),
  };
}

/** Parse and validate an untrusted meeting summary. Never throws. */
export function parseModelSummary(raw: unknown): Result<ModelSummary> {
  let candidate: unknown = raw;
  if (typeof raw === 'string') {
    const json = extractJsonObject(raw);
    if (!json) return { ok: false, error: 'The AI response did not contain a JSON summary.' };
    try {
      candidate = JSON.parse(json);
    } catch {
      return { ok: false, error: 'The AI response contained malformed JSON.' };
    }
  }
  if (candidate && typeof candidate === 'object') {
    const value = candidate as Record<string, unknown>;
    const strings = (input: unknown) => (Array.isArray(input) ? input.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : []);
    candidate = {
      summary: typeof value.summary === 'string' ? value.summary.trim() : '',
      decisions: strings(value.decisions).slice(0, 20),
      openQuestions: strings(value.openQuestions).slice(0, 20),
      actionItems: (Array.isArray(value.actionItems) ? value.actionItems : [])
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .filter((item) => typeof item.task === 'string' && item.task.trim() !== '')
        .slice(0, 30)
        .map((item) => ({
          task: String(item.task).trim(),
          owner: typeof item.owner === 'string' && item.owner.trim() ? item.owner.trim() : null,
          due: typeof item.due === 'string' && item.due.trim() ? item.due.trim() : null,
        })),
    };
  }
  const parsed = ModelSummarySchema.safeParse(candidate);
  if (!parsed.success || !parsed.data.summary) {
    return { ok: false, error: 'The AI response did not match the expected summary format.' };
  }
  return { ok: true, value: parsed.data };
}
