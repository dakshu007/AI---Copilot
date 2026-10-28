import { buildContext } from '../../src/shared/core/contextBuilder';
import { generateDemoAnswer } from '../../src/shared/core/demoAnswer';
import { sessionToMarkdown, sessionToText } from '../../src/shared/core/exporter';
import { GENERAL_PRACTICE_QUESTIONS, practiceQuestionsForJob } from '../../src/shared/core/practiceQuestions';
import { INSUFFICIENT_EVIDENCE_SENTENCE } from '../../src/shared/core/prompt';
import { SessionRecordSchema } from '../../src/shared/schemas';
import { makeJob, makeProfile } from '../fixtures/profiles';

describe('generateDemoAnswer', () => {
  it('uses only the candidate facts it was given', () => {
    const context = buildContext({ profile: makeProfile(), job: null, question: 'Tell me about a payments outage you handled' });
    const answer = generateDemoAnswer({ question: 'Tell me about a payments outage you handled', questionType: 'behavioral', format: 'star', context });
    expect(answer.insufficientResumeEvidence).toBe(false);
    expect(answer.answer).toMatch(/outage/);
    expect(answer.evidenceUsed.length).toBeGreaterThan(0);
    expect(answer.unsupportedClaims).toEqual([]);
  });

  it('admits missing evidence instead of inventing it', () => {
    const context = buildContext({ profile: null, job: null, question: 'Tell me about leading a design system team' });
    const answer = generateDemoAnswer({ question: 'Tell me about leading a design system team', questionType: 'behavioral', format: 'star', context });
    expect(answer.insufficientResumeEvidence).toBe(true);
    expect(answer.answer.startsWith(INSUFFICIENT_EVIDENCE_SENTENCE)).toBe(true);
  });

  it.each(['concise', 'conversational', 'technical'] as const)('produces a %s answer', (format) => {
    const context = buildContext({ profile: makeProfile(), job: null, question: 'How did you use Kubernetes?' });
    const answer = generateDemoAnswer({ question: 'How did you use Kubernetes?', questionType: 'technical', format, context });
    expect(answer.answer).toMatch(/Kubernetes/);
  });
});

describe('practice questions', () => {
  it('tailors questions to the job description', () => {
    const questions = practiceQuestionsForJob(makeJob());
    expect(questions[0]!.text).toContain('Staff Backend Engineer');
    expect(questions.some((q) => q.text.includes('Kubernetes'))).toBe(true);
    expect(practiceQuestionsForJob(null)).toEqual([]);
    expect(GENERAL_PRACTICE_QUESTIONS.length).toBeGreaterThan(10);
  });
});

describe('session export', () => {
  const record = SessionRecordSchema.parse({
    id: 'session_1',
    startedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
    endedAt: Date.UTC(2026, 0, 2, 3, 30, 0),
    mode: 'assist',
    isDemo: true,
    title: 'Mock interview',
    segments: [
      { id: 's1', text: 'Tell me about yourself.', startMs: 65_000, speaker: 'Interviewer', status: 'final' },
      { id: 's2', text: 'partial', startMs: 70_000, status: 'partial' },
    ],
    questions: [{ id: 'q1', text: 'Tell me about yourself.', type: 'role-fit', confidence: 0.9, source: 'detected', detectedAt: 1 }],
    answers: [
      {
        questionId: 'q1',
        answer: 'I am a backend engineer.',
        format: 'concise',
        evidenceUsed: ['E1'],
        unsupportedClaims: [],
        createdAt: 2,
        isDemo: true,
        feedback: 'useful',
      },
    ],
  });

  it('exports Markdown with transcript, questions and answers', () => {
    const md = sessionToMarkdown(record);
    expect(md).toContain('# Mock interview');
    expect(md).toContain('(DEMO data)');
    expect(md).toContain('**[01:05] Interviewer:** Tell me about yourself.');
    expect(md).not.toContain('partial');
    expect(md).toContain('I am a backend engineer.');
    expect(md).toContain('_Marked useful_');
  });

  it('exports plain text without Markdown markers', () => {
    const txt = sessionToText(record);
    expect(txt).not.toMatch(/^#/m);
    expect(txt).not.toContain('**');
    expect(txt).toContain('Mock interview');
  });
});
