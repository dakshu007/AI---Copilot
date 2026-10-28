import { buildContext } from '../../src/shared/core/contextBuilder';
import { makeJob, makeProfile } from '../fixtures/profiles';

describe('buildContext', () => {
  it('ranks the most relevant facts first and cites them by ref', () => {
    const context = buildContext({ profile: makeProfile(), job: makeJob(), question: 'How would you design a rate limiter?' });
    expect(context.hasProfile).toBe(true);
    expect(context.evidence[0]!.text).toMatch(/rate limiting/i);
    expect(context.evidence[0]!.ref).toBe('E1');
    expect(context.text).toContain('[E1]');
    expect(context.text).toContain('Role: Staff Backend Engineer');
  });

  it('stays within the character budget', () => {
    const profile = makeProfile({
      additionalFacts: Array.from({ length: 80 }, (_, i) => `Fact number ${i} about distributed systems and Kubernetes clusters at scale`),
    });
    const context = buildContext({ profile, job: makeJob(), question: 'Tell me about Kubernetes', maxChars: 1_500 });
    expect(context.text.length).toBeLessThan(2_200);
    expect(context.evidence.length).toBeLessThan(40);
  });

  it('says clearly when no candidate facts exist', () => {
    const context = buildContext({ profile: null, job: null, question: 'Tell me about yourself' });
    expect(context.hasProfile).toBe(false);
    expect(context.evidence).toHaveLength(0);
    expect(context.text).toContain('Do not claim any personal experience');
    expect(context.text).toContain('(no job description provided)');
  });

  it('includes bounded recent transcript', () => {
    const context = buildContext({
      profile: makeProfile(),
      job: null,
      question: 'Why?',
      recentTranscript: 'Interviewer: x\n'.repeat(500),
    });
    const transcriptPart = context.text.split('RECENT CONVERSATION (most recent last):\n')[1]!;
    expect(transcriptPart.length).toBeLessThanOrEqual(1_200);
  });
});
