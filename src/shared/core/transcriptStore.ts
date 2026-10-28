import type { TranscriptSegment } from '../types';
import { truncate } from './text';

export interface TranscriptStoreOptions {
  /** Keep at most this many final segments in memory. */
  maxSegments?: number;
}

/**
 * Ordered transcript with partial → final updates. Partial segments are replaced in place
 * when the final version (same id) arrives.
 */
export class TranscriptStore {
  private readonly segments: TranscriptSegment[] = [];
  private readonly index = new Map<string, number>();
  private readonly maxSegments: number;

  constructor(options: TranscriptStoreOptions = {}) {
    this.maxSegments = options.maxSegments ?? 5_000;
  }

  upsert(segment: TranscriptSegment): TranscriptSegment {
    const existing = this.index.get(segment.id);
    if (existing !== undefined) {
      const current = this.segments[existing]!;
      // Never downgrade a final segment back to partial.
      if (current.status === 'final' && segment.status === 'partial') return current;
      this.segments[existing] = segment;
      return segment;
    }
    this.segments.push(segment);
    this.index.set(segment.id, this.segments.length - 1);
    if (this.segments.length > this.maxSegments) this.compact();
    return segment;
  }

  all(): TranscriptSegment[] {
    return [...this.segments];
  }

  finals(): TranscriptSegment[] {
    return this.segments.filter((s) => s.status === 'final' && s.text.trim());
  }

  get(id: string): TranscriptSegment | undefined {
    const position = this.index.get(id);
    return position === undefined ? undefined : this.segments[position];
  }

  /** Most recent final transcript, bounded to `maxChars`, formatted with speaker labels. */
  recentContext(maxChars = 1_500): string {
    const lines: string[] = [];
    let total = 0;
    const finals = this.finals();
    for (let i = finals.length - 1; i >= 0; i -= 1) {
      const segment = finals[i]!;
      const line = `${segment.speaker ?? 'Speaker'}: ${segment.text.trim()}`;
      if (total + line.length > maxChars) {
        if (lines.length === 0) lines.unshift(truncate(line, maxChars));
        break;
      }
      lines.unshift(line);
      total += line.length + 1;
    }
    return lines.join('\n');
  }

  clear(): void {
    this.segments.length = 0;
    this.index.clear();
  }

  get size(): number {
    return this.segments.length;
  }

  private compact(): void {
    const overflow = this.segments.length - this.maxSegments;
    this.segments.splice(0, overflow);
    this.index.clear();
    this.segments.forEach((segment, position) => this.index.set(segment.id, position));
  }
}
