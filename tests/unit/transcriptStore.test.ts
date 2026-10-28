import { TranscriptStore } from '../../src/shared/core/transcriptStore';

describe('TranscriptStore', () => {
  it('replaces partial segments with their final version', () => {
    const store = new TranscriptStore();
    store.upsert({ id: 'a', text: 'Tell me', startMs: 0, status: 'partial' });
    store.upsert({ id: 'a', text: 'Tell me about yourself.', startMs: 0, status: 'final' });
    expect(store.size).toBe(1);
    expect(store.get('a')).toMatchObject({ text: 'Tell me about yourself.', status: 'final' });
  });

  it('never downgrades a final segment', () => {
    const store = new TranscriptStore();
    store.upsert({ id: 'a', text: 'Done.', startMs: 0, status: 'final' });
    store.upsert({ id: 'a', text: 'Do', startMs: 0, status: 'partial' });
    expect(store.get('a')!.status).toBe('final');
  });

  it('builds bounded recent context with speaker labels', () => {
    const store = new TranscriptStore();
    for (let i = 0; i < 50; i += 1) {
      store.upsert({ id: `s${i}`, text: `Line number ${i} with some words`, startMs: i, speaker: i % 2 ? 'You' : 'Interviewer', status: 'final' });
    }
    const context = store.recentContext(200);
    expect(context.length).toBeLessThanOrEqual(200);
    expect(context).toContain('Line number 49');
    expect(context).not.toContain('Line number 1 ');
    expect(context.split('\n')[0]).toMatch(/^(You|Interviewer): /);
  });

  it('caps memory and keeps indexes consistent', () => {
    const store = new TranscriptStore({ maxSegments: 10 });
    for (let i = 0; i < 25; i += 1) store.upsert({ id: `s${i}`, text: `t${i}`, startMs: i, status: 'final' });
    expect(store.size).toBe(10);
    expect(store.get('s0')).toBeUndefined();
    store.upsert({ id: 's24', text: 'updated', startMs: 24, status: 'final' });
    expect(store.get('s24')!.text).toBe('updated');
  });

  it('excludes empty finals from finals()', () => {
    const store = new TranscriptStore();
    store.upsert({ id: 'a', text: '', startMs: 0, status: 'final' });
    store.upsert({ id: 'b', text: 'hello', startMs: 1, status: 'final' });
    expect(store.finals().map((s) => s.id)).toEqual(['b']);
    store.clear();
    expect(store.size).toBe(0);
  });
});
