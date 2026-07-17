// Shared by the turndown rules (image/anchor absolutization) and the
// extract_links tool. Returns the input unchanged when either side is missing
// or the URL constructor rejects the pair, so callers never throw on bad input.
export function absolutize(src: string, baseUrl: string | undefined): string {
  if (!src || !baseUrl) {
    return src;
  }
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return src;
  }
}
