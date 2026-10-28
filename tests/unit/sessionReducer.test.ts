import { initialSessionStore, sessionReducer } from '../../src/renderer/hooks/useSessionStore';
import type { AnswerSuggestion } from '../../src/shared/types';

const suggestion = (questionId: string, createdAt: number): AnswerSuggestion => ({
  questionId,
  answer: 'answer',
  format: 'concise',
  evidenceUsed: [],
  unsupportedClaims: [],
  createdAt,
  insufficientEvidence: false,
  whyThisAnswer: '',
  provider: 'demo',
  isDemo: true,
});

describe('sessionReducer', () => {
  it('upserts transcript segments', () => {
    let store = sessionReducer(initialSessionStore, { type: 'event', event: { type: 'segment', segment: { id: 'a', text: 'Hel', startMs: 0, status: 'partial' } } });
    store = sessionReducer(store, { type: 'event', event: { type: 'segment', segment: { id: 'a', text: 'Hello', startMs: 0, status: 'final' } } });
    expect(store.segments).toEqual([{ id: 'a', text: 'Hello', startMs: 0, status: 'final' }]);
  });

  it('tracks generation lifecycle per question', () => {
    let store = sessionReducer(initialSessionStore, { type: 'event', event: { type: 'answer-start', questionId: 'q', format: 'star' } });
    expect(store.generating.q).toBe('star');
    store = sessionReducer(store, { type: 'event', event: { type: 'answer-error', questionId: 'q', message: 'nope', retryable: true } });
    expect(store.generating.q).toBeUndefined();
    expect(store.answerErrors.q!.message).toBe('nope');
    store = sessionReducer(store, { type: 'event', event: { type: 'answer-start', questionId: 'q', format: 'concise' } });
    expect(store.answerErrors.q).toBeUndefined();
    store = sessionReducer(store, { type: 'event', event: { type: 'answer', suggestion: suggestion('q', 1) } });
    expect(store.answers.q).toHaveLength(1);
  });

  it('puts newest questions first and ignores duplicates', () => {
    const q = (id: string) => ({ id, text: id, type: 'general' as const, confidence: 1, source: 'manual' as const, segmentIds: [], detectedAt: 0 });
    let store = sessionReducer(initialSessionStore, { type: 'event', event: { type: 'question', question: q('1') } });
    store = sessionReducer(store, { type: 'event', event: { type: 'question', question: q('2') } });
    store = sessionReducer(store, { type: 'event', event: { type: 'question', question: q('2') } });
    expect(store.questions.map((x) => x.id)).toEqual(['2', '1']);
  });

  it('clears data when a new session starts', () => {
    let store = sessionReducer(initialSessionStore, { type: 'event', event: { type: 'segment', segment: { id: 'a', text: 'x', startMs: 0, status: 'final' } } });
    store = sessionReducer(store, { type: 'event', event: { type: 'state', state: 'listening', mode: 'assist', isDemo: false, sessionId: 's1' } });
    expect(store.segments).toEqual([]);
    expect(store.state).toBe('listening');
  });

  it('de-duplicates notices and keeps at most four', () => {
    let store = initialSessionStore;
    for (let i = 0; i < 6; i += 1) store = sessionReducer(store, { type: 'notice', level: 'info', message: `m${i}` });
    store = sessionReducer(store, { type: 'notice', level: 'info', message: 'm5' });
    expect(store.notices.map((n) => n.message)).toEqual(['m2', 'm3', 'm4', 'm5']);
    store = sessionReducer(store, { type: 'dismiss-notice', id: store.notices[0]!.id });
    expect(store.notices).toHaveLength(3);
  });
});
