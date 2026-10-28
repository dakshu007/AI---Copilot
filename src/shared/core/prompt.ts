import type { AnswerFormat, QuestionType } from '../types';
import type { BuiltContext } from './contextBuilder';

export const INSUFFICIENT_EVIDENCE_SENTENCE =
  "Your resume doesn't provide enough detail to answer this accurately";

export const SYSTEM_PROMPT = `You are an interview practice coach helping a candidate answer an interview question.

Rules:
- Use ONLY the verified candidate facts and the supplied job description for any claim about the candidate. Never invent work history, skills, metrics, employers, clients, projects, dates, or accomplishments.
- For technical questions, explain the correct concept even if it is not in the candidate facts, but keep general technical knowledge clearly separate from personal experience.
- If the candidate facts do not support a personal answer, set insufficientResumeEvidence to true, begin the answer with "${INSUFFICIENT_EVIDENCE_SENTENCE}." and put a general explanation, clearly labelled as general, in generalExplanation. Suggest what the candidate should clarify.
- Write the answer in the first person, as the candidate would say it aloud: natural, concise, no markdown headings, no bullet symbols unless the format asks for steps.
- Start with a direct first sentence that answers the question.
- In evidenceUsed, list the refs (e.g. "E2") and a few words of each fact you relied on.
- In unsupportedClaims, list anything in your answer that is NOT backed by the facts (ideally none).
- whyThisAnswer: one or two sentences explaining which facts and which requirement of the role shaped the answer.
- followUpQuestion: one likely follow-up question the interviewer may ask, or null.
- Respond with a single JSON object only.`;

const FORMAT_GUIDANCE: Record<AnswerFormat, string> = {
  concise: 'Format: concise. 2–4 sentences. Direct answer first, then one piece of supporting evidence.',
  conversational:
    'Format: conversational. Warm and natural, as if speaking; 3–5 sentences; avoid jargon unless needed.',
  technical:
    'Format: technical. Direct answer, then the key steps or mechanism, then the main trade-offs. Mention relevant personal experience only if it is in the facts.',
  star: 'Format: STAR. Situation, Task, Action, Result in short flowing sentences (you may prefix each with "Situation:", "Task:", "Action:", "Result:"). Only use a situation that exists in the facts.',
};

export function buildUserPrompt(params: {
  question: string;
  questionType: QuestionType;
  format: AnswerFormat;
  maxWords: number;
  context: BuiltContext;
}): string {
  return [
    params.context.text,
    `QUESTION TYPE (heuristic): ${params.questionType}`,
    FORMAT_GUIDANCE[params.format],
    `Keep "answer" under ${params.maxWords} words so it is easy to say aloud.`,
    `INTERVIEW QUESTION: """${params.question.replace(/"""/g, '"')}"""`,
    'Return JSON with exactly these keys: answer (string), evidenceUsed (string[]), unsupportedClaims (string[]), insufficientResumeEvidence (boolean), generalExplanation (string|null), followUpQuestion (string|null), whyThisAnswer (string).',
  ].join('\n\n');
}

/** JSON schema mirror of ModelAnswerSchema for providers that accept a raw schema. */
export const MODEL_ANSWER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'answer',
    'evidenceUsed',
    'unsupportedClaims',
    'insufficientResumeEvidence',
    'generalExplanation',
    'followUpQuestion',
    'whyThisAnswer',
  ],
  properties: {
    answer: { type: 'string' },
    evidenceUsed: { type: 'array', items: { type: 'string' } },
    unsupportedClaims: { type: 'array', items: { type: 'string' } },
    insufficientResumeEvidence: { type: 'boolean' },
    generalExplanation: { type: ['string', 'null'] },
    followUpQuestion: { type: ['string', 'null'] },
    whyThisAnswer: { type: 'string' },
  },
} as const;
