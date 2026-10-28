import { contentTokens, jaccardSimilarity, normalizeText, overlapScore, truncate, uniqueStrings, wordCount } from '../../src/shared/core/text';

describe('text utilities', () => {
  it('normalizes punctuation, case and whitespace', () => {
    expect(normalizeText('  Hello,   WORLD!  It’s C++ ')).toBe("hello world it's c++");
  });

  it('drops stop words from content tokens', () => {
    expect(contentTokens('Tell me about a time you led a migration')).toEqual(['led', 'migration']);
  });

  it('scores similarity and overlap', () => {
    expect(jaccardSimilarity('How would you design a rate limiter?', 'how would you design a rate limiter')).toBe(1);
    expect(jaccardSimilarity('Design a rate limiter', 'Explain garbage collection')).toBe(0);
    expect(overlapScore('kubernetes migration', 'Led the Kubernetes migration')).toBe(1);
    expect(overlapScore('', 'anything')).toBe(0);
  });

  it('truncates on word boundaries', () => {
    const result = truncate('one two three four five six seven', 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.endsWith('…')).toBe(true);
    expect(truncate('short', 20)).toBe('short');
  });

  it('counts words and de-duplicates case-insensitively', () => {
    expect(wordCount('  a b  c ')).toBe(3);
    expect(wordCount('')).toBe(0);
    expect(uniqueStrings(['React', 'react', ' Go ', '', 'Go'])).toEqual(['React', 'Go']);
  });
});
