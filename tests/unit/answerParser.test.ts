import { extractJsonObject, parseModelAnswer, toSuggestion } from '../../src/shared/core/answerParser';
import { INSUFFICIENT_EVIDENCE_SENTENCE } from '../../src/shared/core/prompt';

const valid = {
  answer: 'I would use a token bucket per API key.',
  evidenceUsed: ['E2: Redis rate limiting'],
  unsupportedClaims: [],
  insufficientResumeEvidence: false,
  generalExplanation: null,
  followUpQuestion: 'How would you handle bursts?',
  whyThisAnswer: 'E2 shows direct experience.',
};

describe('extractJsonObject', () => {
  it('handles code fences and surrounding prose', () => {
    expect(extractJsonObject('Sure!\n```json\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(extractJsonObject('Here: {"a": {"b": "}"}} trailing')).toBe('{"a": {"b": "}"}}');
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{"unterminated": ')).toBeNull();
  });
});

describe('parseModelAnswer', () => {
  it('accepts objects and JSON strings', () => {
    expect(parseModelAnswer(valid)).toEqual({ ok: true, value: valid });
    expect(parseModelAnswer(JSON.stringify(valid))).toEqual({ ok: true, value: valid });
  });

  it('is lenient about omitted optional keys', () => {
    const result = parseModelAnswer({ answer: 'Short answer.' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.evidenceUsed).toEqual([]);
      expect(result.value.followUpQuestion).toBeNull();
    }
  });

  it('rejects malformed or empty answers with a recoverable error', () => {
    expect(parseModelAnswer('{"answer": ')).toMatchObject({ ok: false });
    expect(parseModelAnswer('totally not json')).toMatchObject({ ok: false });
    expect(parseModelAnswer({ answer: '' })).toMatchObject({ ok: false });
    expect(parseModelAnswer({ answer: 42 })).toMatchObject({ ok: false });
    expect(parseModelAnswer(null)).toMatchObject({ ok: false });
  });
});

describe('toSuggestion', () => {
  it('enforces the insufficient-evidence disclaimer', () => {
    const suggestion = toSuggestion({
      model: { ...valid, answer: 'Generally, teams use STAR.', insufficientResumeEvidence: true, generalExplanation: 'General info.' },
      questionId: 'q1',
      format: 'star',
      provider: 'test',
      now: 5,
    });
    expect(suggestion.answer.startsWith(INSUFFICIENT_EVIDENCE_SENTENCE)).toBe(true);
    expect(suggestion.insufficientEvidence).toBe(true);
    expect(suggestion.generalExplanation).toBe('General info.');
    expect(suggestion.createdAt).toBe(5);
  });

  it('does not duplicate the disclaimer and trims lists', () => {
    const suggestion = toSuggestion({
      model: {
        ...valid,
        answer: `${INSUFFICIENT_EVIDENCE_SENTENCE}. Here is a general view.`,
        insufficientResumeEvidence: true,
        evidenceUsed: [' a ', '', ...Array.from({ length: 20 }, (_, i) => `e${i}`)],
      },
      questionId: 'q1',
      format: 'concise',
      provider: 'test',
    });
    expect(suggestion.answer.split(INSUFFICIENT_EVIDENCE_SENTENCE).length).toBe(2);
    expect(suggestion.evidenceUsed[0]).toBe('a');
    expect(suggestion.evidenceUsed.length).toBeLessThanOrEqual(12);
    expect(suggestion.followUpQuestion).toBe('How would you handle bursts?');
  });
});
