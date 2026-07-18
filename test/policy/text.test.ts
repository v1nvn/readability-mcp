import {
  computeTextMetrics,
  countWords,
  estimateTokens,
  nonEmpty,
} from '../../src/policy/text.js';

describe('estimateTokens', () => {
  it('returns chars/4 for prose and names the estimator', () => {
    const textContent = 'The quick brown fox jumps over the lazy dog near the riverbank.';
    expect(estimateTokens(textContent)).toEqual({
      tokenEstimate: Math.round(textContent.length / 4),
      estimator: 'chars/4',
    });
  });

  it('returns zero for empty textContent', () => {
    expect(estimateTokens('')).toEqual({ tokenEstimate: 0, estimator: 'chars/4' });
  });
});

describe('countWords', () => {
  it('counts whitespace-separated runs', () => {
    expect(countWords('the quick  brown\nfox')).toBe(4);
  });

  it('returns zero for whitespace-only text', () => {
    expect(countWords('   \n\t ')).toBe(0);
  });
});

describe('nonEmpty', () => {
  it('returns the value when it has non-whitespace content', () => {
    expect(nonEmpty('  hi ')).toBe('  hi ');
  });

  it('returns undefined for blank or missing input', () => {
    expect(nonEmpty('   ')).toBeUndefined();
    expect(nonEmpty(undefined)).toBeUndefined();
  });
});

describe('computeTextMetrics', () => {
  it('rounds reading time up to at least one minute for non-empty text', () => {
    expect(computeTextMetrics('one two three', 200)).toMatchObject({
      wordCount: 3,
      readingTimeMin: 1,
    });
  });

  it('reports zero reading time for empty text', () => {
    expect(computeTextMetrics('', 200)).toMatchObject({
      wordCount: 0,
      readingTimeMin: 0,
      tokenEstimate: 0,
      estimator: 'chars/4',
    });
  });
});
