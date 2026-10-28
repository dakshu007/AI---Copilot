import { classifyQuestion, suggestedFormatFor } from '../../src/shared/core/questionClassifier';

describe('classifyQuestion', () => {
  it.each([
    ['Tell me about a time you disagreed with your manager.', 'behavioral'],
    ['Give me an example of a project that failed.', 'behavioral'],
    ['How would you design a rate limiter for a public API?', 'technical'],
    ['Explain the difference between a process and a thread.', 'technical'],
    ['What would you do if a teammate missed a deadline?', 'situational'],
    ['Why do you want to work here?', 'role-fit'],
    ['Tell me about yourself.', 'role-fit'],
    ['And what was the result?', 'follow-up'],
  ])('detects "%s" as %s', (text, type) => {
    const result = classifyQuestion(text);
    expect(result.isQuestion).toBe(true);
    expect(result.type).toBe(type);
  });

  it.each([
    'Okay.',
    'Thanks!',
    'I think that makes sense.',
    'We use Kubernetes heavily here.',
    'Can you hear me okay?',
    'How are you doing today?',
    'Is that okay?',
    'Yes',
  ])('ignores non-questions and small talk: "%s"', (text) => {
    expect(classifyQuestion(text).isQuestion).toBe(false);
  });

  it('accepts imperative prompts without a question mark', () => {
    expect(classifyQuestion('Walk me through your most recent project').isQuestion).toBe(true);
  });

  it('suggests answer styles by type', () => {
    expect(suggestedFormatFor('behavioral')).toBe('star');
    expect(suggestedFormatFor('technical')).toBe('technical');
    expect(suggestedFormatFor('role-fit')).toBe('conversational');
    expect(suggestedFormatFor('general')).toBe('concise');
  });
});
