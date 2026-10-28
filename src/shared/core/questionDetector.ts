import type { DetectedQuestion, TranscriptSegment } from '../types';
import { classifyQuestion } from './questionClassifier';
import { createId } from './ids';
import { jaccardSimilarity, normalizeText, wordCount } from './text';

export interface QuestionDetectorOptions {
  /** Wait this long after the last transcript activity before deciding (ms). */
  debounceMs?: number;
  /** Two questions with at least this token similarity are treated as duplicates. */
  duplicateThreshold?: number;
  /** How long a question stays in the duplicate-check window (ms). */
  duplicateWindowMs?: number;
  /** Maximum buffered words before a forced flush (long monologues). */
  maxBufferWords?: number;
  now?: () => number;
  onQuestion: (question: DetectedQuestion) => void;
  onDuplicate?: (text: string, existing: DetectedQuestion) => void;
}

interface Pending {
  texts: string[];
  segmentIds: string[];
}

const SENTENCE_SPLIT = /(?<=[.?!])\s+(?=[A-Z0-9"'(])/;

/**
 * Turns a stream of transcript segments into de-duplicated interviewer questions.
 *
 * - Only `final` segments are buffered; `partial` segments merely postpone the decision so we
 *   don't call the language model for every partial token.
 * - Candidate speech (role === 'candidate') is ignored, so the user's own answer is not
 *   mistaken for a question.
 * - Near-identical questions within the duplicate window are dropped.
 */
export class QuestionDetector {
  private readonly debounceMs: number;
  private readonly duplicateThreshold: number;
  private readonly duplicateWindowMs: number;
  private readonly maxBufferWords: number;
  private readonly now: () => number;
  private pending: Pending = { texts: [], segmentIds: [] };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private recent: DetectedQuestion[] = [];

  constructor(private readonly options: QuestionDetectorOptions) {
    this.debounceMs = options.debounceMs ?? 1_300;
    this.duplicateThreshold = options.duplicateThreshold ?? 0.72;
    this.duplicateWindowMs = options.duplicateWindowMs ?? 15 * 60_000;
    this.maxBufferWords = options.maxBufferWords ?? 120;
    this.now = options.now ?? (() => Date.now());
  }

  /** Feed every transcript update (partial and final). */
  ingest(segment: TranscriptSegment): void {
    if (segment.role === 'candidate') return;
    if (segment.status === 'partial') {
      // Interviewer still speaking: postpone any pending decision.
      if (this.pending.texts.length > 0) this.schedule();
      return;
    }
    const text = segment.text.trim();
    if (!text) return;
    this.pending.texts.push(text);
    this.pending.segmentIds.push(segment.id);
    if (wordCount(this.pending.texts.join(' ')) >= this.maxBufferWords) {
      this.flush();
    } else {
      this.schedule();
    }
  }

  /** Let the user force a question (e.g. by selecting transcript text). */
  markManual(
    text: string,
    segmentIds: string[] = [],
    source: 'manual' | 'practice' = 'manual',
  ): DetectedQuestion | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const normalized = normalizeText(trimmed);
    const sameRecent = this.recent.find(
      (q) => normalizeText(q.text) === normalized && this.now() - q.detectedAt < 3_000,
    );
    if (sameRecent) return null;
    const classification = classifyQuestion(trimmed.endsWith('?') ? trimmed : `${trimmed}?`);
    const question: DetectedQuestion = {
      id: createId('q'),
      text: trimmed,
      type: classification.type,
      confidence: 1,
      source,
      segmentIds,
      detectedAt: this.now(),
    };
    this.remember(question);
    this.options.onQuestion(question);
    return question;
  }

  /** Decide immediately (used when a session stops). */
  flush(): void {
    this.clearTimer();
    const { texts, segmentIds } = this.pending;
    this.pending = { texts: [], segmentIds: [] };
    if (texts.length === 0) return;
    const questionText = extractQuestion(texts.join(' '));
    if (!questionText) return;
    const classification = classifyQuestion(questionText);
    if (!classification.isQuestion) return;

    const duplicate = this.findDuplicate(questionText);
    if (duplicate) {
      this.options.onDuplicate?.(questionText, duplicate);
      return;
    }
    const question: DetectedQuestion = {
      id: createId('q'),
      text: questionText,
      type: classification.type,
      confidence: Number(classification.confidence.toFixed(2)),
      source: 'detected',
      segmentIds,
      detectedAt: this.now(),
    };
    this.remember(question);
    this.options.onQuestion(question);
  }

  reset(): void {
    this.clearTimer();
    this.pending = { texts: [], segmentIds: [] };
    this.recent = [];
  }

  dispose(): void {
    this.clearTimer();
  }

  private findDuplicate(text: string): DetectedQuestion | undefined {
    const cutoff = this.now() - this.duplicateWindowMs;
    this.recent = this.recent.filter((q) => q.detectedAt >= cutoff);
    const normalized = normalizeText(text);
    return this.recent.find((q) => {
      const other = normalizeText(q.text);
      if (other === normalized) return true;
      return jaccardSimilarity(other, normalized) >= this.duplicateThreshold;
    });
  }

  private remember(question: DetectedQuestion): void {
    this.recent.push(question);
    if (this.recent.length > 50) this.recent.shift();
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * Pick the question part of a buffered utterance. Leading acknowledgements such as
 * "Great, thanks." are dropped; one sentence of setup before the first question sentence is
 * kept so situational prompts ("Imagine X. What would you do?") remain understandable.
 */
export function extractQuestion(utterance: string): string | null {
  const sentences = utterance
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  const questionIndexes = sentences
    .map((sentence, index) => (classifyQuestion(sentence).isQuestion ? index : -1))
    .filter((index) => index >= 0);

  if (questionIndexes.length === 0) {
    // Only fall back to the whole utterance when it could not be split into sentences.
    return sentences.length === 1 && classifyQuestion(utterance).isQuestion ? utterance.trim() : null;
  }

  const first = questionIndexes[0]!;
  const last = questionIndexes[questionIndexes.length - 1]!;
  let start = first;
  const previous = sentences[first - 1];
  if (previous && wordCount(previous) > 4) start = first - 1;
  return sentences.slice(start, last + 1).join(' ');
}
