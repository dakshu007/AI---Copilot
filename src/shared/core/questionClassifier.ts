import type { QuestionType } from '../types';
import { normalizeText, wordCount } from './text';

export interface QuestionClassification {
  isQuestion: boolean;
  type: QuestionType;
  confidence: number;
}

const INTERROGATIVE_START =
  /^(what|why|how|when|where|which|who|whom|whose|can|could|would|will|should|do|does|did|is|are|was|were|have|has|had|may|might|shall)\b/;

const IMPERATIVE_PROMPTS = [
  /\btell (me|us) about\b/,
  /\bwalk (me|us) through\b/,
  /\b(describe|explain|define|compare|contrast|design|implement|outline|summari[sz]e)\b/,
  /\bgive (me|us) an? (example|overview|sense)\b/,
  /\btalk (me|us)? ?(about|through)\b/,
  /\bshare (an? )?(example|time|situation)\b/,
  /\bhelp (me|us) understand\b/,
  /\bi'?d (like|love) to (hear|know|understand)\b/,
  /\bcan you (tell|walk|describe|explain|give|share)\b/,
  /\bwhat (would|did|do) you\b/,
  /\bhow would you\b/,
];

const BEHAVIORAL = [
  /\btell (me|us) about a time\b/,
  /\b(a|one) time (when|where|that)\b/,
  /\bdescribe a (situation|time|project|challenge|conflict|failure|mistake)\b/,
  /\bgive (me|us) an example\b/,
  /\b(conflict|disagree|disagreement|mistake|failure|failed|setback|difficult (person|stakeholder|colleague|teammate)|feedback|proud(est)?|biggest (challenge|achievement|weakness|strength)|leadership|influence|persuade|deadline|pressure|prioriti[sz]e)\b/,
];

const SITUATIONAL = [/\bwhat would you do if\b/, /\bhow would you (handle|approach|deal|respond)\b/, /\bimagine\b/, /\bsuppose\b/, /\bhypothetical/];

const ROLE_FIT = [
  /\bwhy (do you want|are you interested|this (role|company|position)|should we hire|us)\b/,
  /\bwhere do you see yourself\b/,
  /\b(strengths?|weakness(es)?|salary|notice period|relocat|career goals?|motivat)\b/,
  /\btell (me|us) about yourself\b/,
  /\bwhat do you know about (us|our company|the company)\b/,
];

const FOLLOW_UP = [
  /^(and|so|but|also|then|okay so|ok so|right so)\b/,
  /\b(follow[- ]?up|go deeper|elaborate|expand on|more detail|what happened (next|after)|how did (that|it) (go|turn out)|why (that|did you)|what was the (result|outcome|impact))\b/,
];

const TECHNICAL_TERMS =
  /\b(algorithm|complexity|big[- ]o|data structure|array|hash ?map|hash ?table|linked list|tree|graph|heap|queue|stack|recursion|dynamic programming|database|sql|nosql|index(es|ing)?|transaction|acid|cap theorem|consisten(t|cy)|cache|caching|latency|throughput|scal(e|ing|ability)|load balanc|microservices?|monolith|api|rest|graphql|grpc|http|tcp|udp|dns|tls|oauth|jwt|authentication|authorization|encryption|kubernetes|docker|container|ci\/?cd|deploy(ment)?|cloud|aws|gcp|azure|serverless|queue|kafka|event[- ]driven|concurren(t|cy)|thread|async|promise|closure|garbage collection|memory leak|react|typescript|javascript|python|java|golang|rust|c\+\+|machine learning|model|regression|classification|neural|gradient|overfitting|statistics|a\/b test|system design|design a|architecture|race condition|deadlock|mutex|sharding|replication|partition|polymorphism|inheritance|solid|design pattern|unit test|integration test|debug|profil(e|ing)|observability|monitoring)\b/;

/** Meeting small talk that should never trigger an answer. */
const SMALL_TALK =
  /^(hi|hello|hey|good (morning|afternoon|evening)|thanks|great|okay|ok|so|alright|right)?[,.!\s]*(can|could) you (hear|see) (me|us|my screen)|^(hi|hello|hey)?[,.!\s]*how are you( doing)?( today)?\??$|\b(is|was) (that|this) (okay|ok|clear|alright)\??$|^(are you|you) (ready|there)\??$|\b(any|do you have any) questions for (me|us)\b.*\?$|^(shall|should) we (start|begin|get started)\??$/;

const FILLER_ONLY = /^(ok(ay)?|yeah|yes|no|right|sure|great|thanks|thank you|cool|got it|mm+|uh+|um+|hmm+|alright)[.!?]*$/;

/**
 * Lightweight, local heuristic classifier. It never calls a model, so it can run on every
 * final transcript segment cheaply. It intentionally errs on the side of fewer false positives:
 * the user can always mark a line as a question manually.
 */
export function classifyQuestion(rawText: string): QuestionClassification {
  const trimmed = rawText.trim();
  const text = normalizeText(trimmed);
  const words = wordCount(text);
  const notQuestion: QuestionClassification = { isQuestion: false, type: 'general', confidence: 0 };

  if (words < 3 || FILLER_ONLY.test(text) || SMALL_TALK.test(text)) return notQuestion;

  let score = 0;
  if (trimmed.endsWith('?')) score += 0.55;
  if (INTERROGATIVE_START.test(text)) score += 0.3;
  if (IMPERATIVE_PROMPTS.some((pattern) => pattern.test(text))) score += 0.5;
  if (words >= 6) score += 0.05;
  // Statements like "I think that's right." should not be picked up.
  if (/^(i|we|i'm|i've|we're|that's|this is|it's)\b/.test(text) && !trimmed.endsWith('?')) score -= 0.4;

  const confidence = Math.max(0, Math.min(1, score));
  if (confidence < 0.5) return { ...notQuestion, confidence };

  let type: QuestionType = 'general';
  if (FOLLOW_UP.some((p) => p.test(text)) && words < 14) type = 'follow-up';
  else if (SITUATIONAL.some((p) => p.test(text))) type = 'situational';
  else if (BEHAVIORAL.some((p) => p.test(text))) type = 'behavioral';
  else if (ROLE_FIT.some((p) => p.test(text))) type = 'role-fit';
  else if (TECHNICAL_TERMS.test(text)) type = 'technical';

  return { isQuestion: true, type, confidence };
}

/** Suggest a default answer style for a question type. */
export function suggestedFormatFor(type: QuestionType): 'star' | 'technical' | 'concise' | 'conversational' {
  switch (type) {
    case 'behavioral':
      return 'star';
    case 'technical':
      return 'technical';
    case 'role-fit':
      return 'conversational';
    default:
      return 'concise';
  }
}
