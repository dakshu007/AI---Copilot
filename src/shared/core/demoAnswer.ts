import type { AnswerFormat, ModelAnswer, QuestionType } from '../types';
import type { BuiltContext } from './contextBuilder';
import { INSUFFICIENT_EVIDENCE_SENTENCE } from './prompt';
import { contentTokens, overlapScore, truncate } from './text';

/**
 * Offline answer generator used in demo mode and when no AI provider is configured.
 * It only stitches together the user's own verified facts, so it cannot fabricate anything;
 * the UI labels its output as a demo.
 */
export function generateDemoAnswer(params: {
  question: string;
  questionType: QuestionType;
  format: AnswerFormat;
  context: BuiltContext;
}): ModelAnswer {
  const tokens = contentTokens(params.question);
  const relevant = params.context.evidence
    .filter((item) => item.kind !== 'skill')
    .map((item) => ({ item, score: overlapScore(tokens, item.text) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ item }) => item);

  const fallback = params.context.evidence.filter((e) => e.kind === 'experience' || e.kind === 'summary').slice(0, 1);
  const isAboutCandidate = params.questionType === 'role-fit' && fallback.length > 0;
  const chosen = relevant.length > 0 ? relevant : isAboutCandidate ? fallback : [];

  if (chosen.length === 0) {
    return {
      answer: `${INSUFFICIENT_EVIDENCE_SENTENCE}. Add a relevant example to your profile, or connect an AI provider in Settings for a general explanation.`,
      evidenceUsed: [],
      unsupportedClaims: [],
      insufficientResumeEvidence: true,
      generalExplanation:
        params.questionType === 'technical'
          ? 'Demo mode cannot generate technical explanations. Connect an AI provider for a full answer.'
          : null,
      followUpQuestion: null,
      whyThisAnswer: 'No fact in your verified profile matched this question, so nothing was claimed on your behalf.',
    };
  }

  const facts = chosen.map((e) => truncate(e.text.replace(/\s+/g, ' '), 220));
  let answer: string;
  switch (params.format) {
    case 'star': {
      const [first] = facts;
      answer = [
        `Situation: ${first}.`,
        'Task: [describe what you were responsible for].',
        'Action: [the specific steps you took].',
        `Result: ${/\d/.test(first ?? '') ? 'the measurable outcome noted above' : '[add the measurable outcome]'}.`,
      ].join(' ');
      break;
    }
    case 'technical':
      answer = `From my experience: ${facts.join(' Also: ')}. (Demo mode: connect an AI provider for the concept explanation and trade-offs.)`;
      break;
    case 'conversational':
      answer = `Happy to talk about that. ${facts.map((f) => `One relevant example is ${f}.`).join(' ')}`;
      break;
    default:
      answer = `The most relevant example from my background: ${facts.join('; ')}.`;
  }

  return {
    answer,
    evidenceUsed: chosen.map((e) => `${e.ref}: ${truncate(e.text, 80)}`),
    unsupportedClaims: [],
    insufficientResumeEvidence: false,
    generalExplanation: null,
    followUpQuestion: 'What was the measurable impact, and what would you do differently?',
    whyThisAnswer: `Picked the profile facts that share the most keywords with the question (${chosen
      .map((e) => e.ref)
      .join(', ')}). Demo answers only rearrange your own facts.`,
  };
}
