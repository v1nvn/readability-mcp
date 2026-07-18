export const TOKEN_ESTIMATOR = 'chars/4';

export function estimateTokens(textContent: string): {
  estimator: string;
  tokenEstimate: number;
} {
  return {
    tokenEstimate: Math.round(textContent.length / 4),
    estimator: TOKEN_ESTIMATOR,
  };
}

export function countWords(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

export function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

export interface TextMetrics {
  readonly estimator: string;
  readonly readingTimeMin: number;
  readonly tokenEstimate: number;
  readonly wordCount: number;
}

export function computeTextMetrics(
  text: string,
  wordsPerMinute: number,
): TextMetrics {
  const wordCount = countWords(text);
  const readingTimeMin =
    wordCount === 0 ? 0 : Math.max(1, Math.round(wordCount / wordsPerMinute));
  return { wordCount, readingTimeMin, ...estimateTokens(text) };
}
