import type { AnswerFormat, QuestionType, SessionMode } from '../types';
import type { BuiltContext } from './contextBuilder';

export const INSUFFICIENT_EVIDENCE_SENTENCE =
  "Your resume doesn't provide enough detail to answer this accurately";

/** Used in team meetings, where the facts come from your work profile and meeting notes. */
export const INSUFFICIENT_CONTEXT_SENTENCE = "Your notes don't cover this, so confirm the details before committing";

export function insufficientSentenceFor(mode: SessionMode | undefined): string {
  return mode === 'meeting' ? INSUFFICIENT_CONTEXT_SENTENCE : INSUFFICIENT_EVIDENCE_SENTENCE;
}

const SHARED_RULES = `- Start with a direct first sentence.
- In evidenceUsed, list the refs (e.g. "E2") and a few words of each fact you relied on.
- In unsupportedClaims, list anything in your answer that is NOT backed by the facts (ideally none).
- whyThisAnswer: one or two sentences explaining which facts shaped the answer.
- followUpQuestion: one likely follow-up question, or null.
- Respond with a single JSON object only.`;

export const SYSTEM_PROMPT = `You are an interview practice coach helping a candidate answer an interview question.

Rules:
- Use ONLY the verified candidate facts and the supplied job description for any claim about the candidate. Never invent work history, skills, metrics, employers, clients, projects, dates, or accomplishments.
- For technical questions, explain the correct concept even if it is not in the candidate facts, but keep general technical knowledge clearly separate from personal experience.
- If the candidate facts do not support a personal answer, set insufficientResumeEvidence to true, begin the answer with "${INSUFFICIENT_EVIDENCE_SENTENCE}." and put a general explanation, clearly labelled as general, in generalExplanation. Suggest what the candidate should clarify.
- Write the answer in the first person, as the candidate would say it aloud: natural, concise, no markdown headings, no bullet symbols unless the format asks for steps.
${SHARED_RULES}`;

export const MEETING_SYSTEM_PROMPT = `You are a communication coach for a team lead in a live work meeting. A teammate has just asked something or raised a point. Suggest what the lead could say next.

Rules:
- Sound like a calm, respectful, decisive lead: acknowledge the person, answer clearly, and end with a concrete next step, owner or timeline when it fits.
- Use ONLY the lead's verified work facts and meeting notes for claims about projects, status, numbers, dates, people or commitments. Never invent facts, metrics, deadlines or promises.
- If the notes do not contain what is needed, set insufficientResumeEvidence to true, begin the answer with "${INSUFFICIENT_CONTEXT_SENTENCE}." and suggest a good holding response or a clarifying question instead of guessing. General best-practice advice may go in generalExplanation, clearly labelled as general.
- Prefer inclusive, non-defensive language. Avoid blame and jargon. Keep it short enough to say in 20–40 seconds.
- Write in the first person as the lead would say it aloud: no markdown headings, no bullet symbols.
${SHARED_RULES}`;

export function systemPromptFor(mode: SessionMode | undefined): string {
  return mode === 'meeting' ? MEETING_SYSTEM_PROMPT : SYSTEM_PROMPT;
}

const FORMAT_GUIDANCE: Record<AnswerFormat, string> = {
  concise: 'Format: concise. 2–4 sentences. Direct answer first, then one piece of supporting evidence.',
  conversational:
    'Format: conversational. Warm and natural, as if speaking; 3–5 sentences; avoid jargon unless needed.',
  technical:
    'Format: technical. Direct answer, then the key steps or mechanism, then the main trade-offs. Mention relevant personal experience only if it is in the facts.',
  star: 'Format: STAR. Situation, Task, Action, Result in short flowing sentences (you may prefix each with "Situation:", "Task:", "Action:", "Result:"). Only use a situation that exists in the facts.',
  diplomatic:
    'Format: diplomatic. Acknowledge the other person\'s point or concern first, state your position clearly and kindly, then propose a specific next step or compromise.',
};

export function buildUserPrompt(params: {
  question: string;
  questionType: QuestionType;
  format: AnswerFormat;
  maxWords: number;
  context: BuiltContext;
  mode?: SessionMode;
}): string {
  const meeting = params.mode === 'meeting';
  return [
    params.context.text,
    `QUESTION TYPE (heuristic): ${params.questionType}`,
    FORMAT_GUIDANCE[params.format],
    `Keep "answer" under ${params.maxWords} words so it is easy to say aloud.`,
    `${meeting ? 'WHAT THE TEAMMATE SAID' : 'INTERVIEW QUESTION'}: """${params.question.replace(/"""/g, '"')}"""`,
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

/* ------------------------------------------------------------------ */
/* Meeting summary                                                     */
/* ------------------------------------------------------------------ */

export const SUMMARY_SYSTEM_PROMPT = `You summarise work meetings for a team lead.

Rules:
- Use ONLY what is in the transcript. Never invent decisions, owners, dates or numbers.
- summary: 2–4 sentences on what was discussed and where things landed.
- decisions: things the group clearly agreed. Empty if none were made.
- actionItems: concrete follow-ups. owner is the person's name or "You" only if the transcript says who; otherwise null. due only if a time was stated; otherwise null.
- openQuestions: unresolved questions or risks worth following up.
- Be concise and neutral. Respond with a single JSON object only.`;

export function buildSummaryPrompt(params: { transcript: string; meetingContext?: string }): string {
  return [
    params.meetingContext?.trim() ? `MEETING NOTES / AGENDA:\n${params.meetingContext.trim()}` : '',
    `TRANSCRIPT (speaker: text):\n${params.transcript}`,
    'Return JSON with exactly these keys: summary (string), decisions (string[]), actionItems ({task: string, owner: string|null, due: string|null}[]), openQuestions (string[]).',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const MODEL_SUMMARY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'decisions', 'actionItems', 'openQuestions'],
  properties: {
    summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
    actionItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['task', 'owner', 'due'],
        properties: {
          task: { type: 'string' },
          owner: { type: ['string', 'null'] },
          due: { type: ['string', 'null'] },
        },
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
} as const;
