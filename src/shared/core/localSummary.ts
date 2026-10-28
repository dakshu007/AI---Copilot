import type { ModelSummary, TranscriptSegment } from '../types';
import { classifyQuestion } from './questionClassifier';
import { contentTokens } from './text';

const ACTION = /\b(i'll|i will|we'll|we will|let me|i'm going to|you'll|can you|could you|please|action item|follow up|follow-up|need to|needs to|should)\b/i;
const DECISION = /\b(we('ll| will) go with|let's go with|decided|agreed|the plan is|we'll use|final answer|going forward)\b/i;
const DUE =
  /\b(today|tonight|tomorrow|this week|next week|end of (the )?(day|week|month|sprint)|eod|eow|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(next )?(monday|tuesday|wednesday|thursday|friday))\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Offline meeting summary built only from the transcript (used in demo mode and when no AI
 * provider is configured). Heuristic and clearly labelled as such in the UI.
 */
export function generateLocalSummary(segments: TranscriptSegment[]): ModelSummary {
  const finals = segments.filter((s) => s.status === 'final' && s.text.trim());
  const decisions: string[] = [];
  const actionItems: ModelSummary['actionItems'] = [];
  const openQuestions: string[] = [];

  for (const segment of finals) {
    const speaker = segment.role === 'candidate' ? 'You' : segment.speaker && segment.speaker !== 'Speaker' ? segment.speaker : null;
    for (const sentence of sentences(segment.text)) {
      if (DECISION.test(sentence)) decisions.push(sentence);
      else if (ACTION.test(sentence) && !sentence.endsWith('?')) {
        const selfCommitment = /\b(i'll|i will|let me|i'm going to)\b/i.test(sentence);
        actionItems.push({
          task: sentence,
          owner: selfCommitment ? speaker : null,
          due: sentence.match(DUE)?.[0] ?? null,
        });
      } else if (sentence.endsWith('?') && classifyQuestion(sentence).isQuestion && segment.role !== 'candidate') {
        openQuestions.push(sentence);
      }
    }
  }

  const frequency = new Map<string, number>();
  for (const segment of finals) {
    for (const token of contentTokens(segment.text)) {
      if (token.length < 4 || /^\d+$/.test(token)) continue;
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }
  const topics = [...frequency.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([token]) => token);
  const speakers = new Set(finals.map((s) => (s.role === 'candidate' ? 'You' : s.speaker ?? 'Speaker')));

  const summary =
    finals.length === 0
      ? 'Nothing was transcribed yet.'
      : `${speakers.size} ${speakers.size === 1 ? 'speaker' : 'speakers'} discussed ${topics.length ? topics.join(', ') : 'several topics'}. ${decisions.length} decision${decisions.length === 1 ? '' : 's'} and ${actionItems.length} possible action item${actionItems.length === 1 ? '' : 's'} were noted. (Offline summary: connect an AI provider for a fuller one.)`;

  return {
    summary,
    decisions: decisions.slice(0, 10),
    actionItems: actionItems.slice(0, 15),
    openQuestions: openQuestions.slice(-5),
  };
}
