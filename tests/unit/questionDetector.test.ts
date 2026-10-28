import { QuestionDetector, extractQuestion } from '../../src/shared/core/questionDetector';
import type { DetectedQuestion, TranscriptSegment } from '../../src/shared/types';

function segment(text: string, overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return { id: `s-${Math.random()}`, text, startMs: 0, status: 'final', role: 'interviewer', speaker: 'Interviewer', ...overrides };
}

describe('QuestionDetector', () => {
  let questions: DetectedQuestion[];
  let detector: QuestionDetector;
  let now: number;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000_000;
    questions = [];
    detector = new QuestionDetector({ debounceMs: 1_000, now: () => now, onQuestion: (q) => questions.push(q) });
  });

  afterEach(() => {
    detector.dispose();
    vi.useRealTimers();
  });

  it('waits for the debounce window before emitting', () => {
    detector.ingest(segment('How would you design a rate limiter?'));
    vi.advanceTimersByTime(900);
    expect(questions).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ type: 'technical', source: 'detected' });
  });

  it('ignores partial segments but lets them postpone the decision', () => {
    detector.ingest(segment('Tell me about a time', { status: 'partial' }));
    vi.advanceTimersByTime(5_000);
    expect(questions).toHaveLength(0);

    detector.ingest(segment('Tell me about a time you resolved a conflict.'));
    vi.advanceTimersByTime(800);
    detector.ingest(segment('when', { status: 'partial' })); // still speaking
    vi.advanceTimersByTime(800);
    expect(questions).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(questions).toHaveLength(1);
  });

  it('merges consecutive final segments of one utterance', () => {
    detector.ingest(segment('Great answer, thanks.'));
    detector.ingest(segment('Imagine your service suddenly gets ten times more traffic.'));
    detector.ingest(segment('What would you do first?'));
    vi.advanceTimersByTime(1_100);
    expect(questions).toHaveLength(1);
    expect(questions[0]!.text).toBe('Imagine your service suddenly gets ten times more traffic. What would you do first?');
    expect(questions[0]!.segmentIds).toHaveLength(3);
  });

  it('does not create duplicate questions', () => {
    const onDuplicate = vi.fn();
    detector = new QuestionDetector({ debounceMs: 1_000, now: () => now, onQuestion: (q) => questions.push(q), onDuplicate });
    detector.ingest(segment('How would you design a rate limiter for an API?'));
    vi.advanceTimersByTime(1_100);
    detector.ingest(segment('So how would you design a rate limiter for an API?'));
    vi.advanceTimersByTime(1_100);
    expect(questions).toHaveLength(1);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });

  it('allows the same question again after the duplicate window', () => {
    detector.ingest(segment('Why do you want this role?'));
    vi.advanceTimersByTime(1_100);
    now += 16 * 60_000;
    detector.ingest(segment('Why do you want this role?'));
    vi.advanceTimersByTime(1_100);
    expect(questions).toHaveLength(2);
  });

  it("ignores the candidate's own speech", () => {
    detector.ingest(segment('What would you like me to cover first?', { role: 'candidate', speaker: 'You' }));
    vi.advanceTimersByTime(2_000);
    expect(questions).toHaveLength(0);
  });

  it('ignores statements and small talk', () => {
    detector.ingest(segment('Hi, thanks for joining today. Can you hear me okay?'));
    vi.advanceTimersByTime(1_100);
    detector.ingest(segment('We mostly use Go and Postgres on this team.'));
    vi.advanceTimersByTime(1_100);
    expect(questions).toHaveLength(0);
  });

  it('flushes immediately on demand', () => {
    detector.ingest(segment('Explain how database indexes work.'));
    detector.flush();
    expect(questions).toHaveLength(1);
  });

  it('forces a flush when the buffer gets very long', () => {
    const long = `${'word '.repeat(130)}what is your biggest strength?`;
    detector.ingest(segment(long));
    expect(questions).toHaveLength(1);
  });

  it('supports manual questions and suppresses accidental double clicks', () => {
    const first = detector.markManual('Our stack is mostly Rust');
    const second = detector.markManual('Our stack is mostly Rust');
    expect(first).not.toBeNull();
    expect(first!.source).toBe('manual');
    expect(first!.confidence).toBe(1);
    expect(second).toBeNull();
    expect(detector.markManual('   ')).toBeNull();
    expect(detector.markManual('Practice: tell me about yourself', [], 'practice')!.source).toBe('practice');
  });
});

describe('extractQuestion', () => {
  it('drops leading acknowledgements', () => {
    expect(extractQuestion('Okay. Thanks. How do you handle on-call?')).toBe('How do you handle on-call?');
  });

  it('returns null for statements', () => {
    expect(extractQuestion('That is all from me. We will be in touch.')).toBeNull();
  });
});
