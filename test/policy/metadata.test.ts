import { buildDocument } from '../../src/pipeline/dom.js';
import type { ReadabilityParseResult } from '../../src/pipeline/readability.js';
import { estimateTokens, resolveMetadata } from '../../src/policy/metadata.js';

function doc(html: string): Document {
  return buildDocument(html, 'https://example.com/page').document;
}

describe('policy.metadata cascade priority', () => {
  it('JSON-LD beats OpenGraph, Twitter, meta, Readability, and <title>', () => {
    const html = `
<html lang="en-US"><head>
  <title>title-tag</title>
  <meta name="description" content="meta-desc">
  <meta name="author" content="Meta Author">
  <meta property="og:title" content="OG Title">
  <meta property="og:site_name" content="OG Site">
  <meta property="og:description" content="OG desc">
  <meta property="article:published_time" content="2026-01-02T00:00:00Z">
  <meta name="twitter:title" content="Twitter Title">
  <script type="application/ld+json">
  {"@type":"Article","headline":"JSON-LD Headline","author":{"@type":"Person","name":"LD Author"},
   "datePublished":"2026-07-01T08:00:00Z","description":"LD desc","inLanguage":"fr",
   "publisher":{"@type":"Organization","name":"LD Publisher"}}
  </script>
</head><body><article><h1>JSON-LD Headline</h1><time datetime="2026-03-03T00:00:00Z">Mar 3</time></article></body></html>`;
    const readability: ReadabilityParseResult = {
      title: 'R Title',
      byline: 'R Byline',
      excerpt: 'R excerpt',
      siteName: 'R Site',
      lang: 'de',
      publishedTime: '2026-05-05T00:00:00Z',
    };
    const m = resolveMetadata({
      document: doc(html),
      readability,
      url: 'https://example.com/page',
      textContent: 'word word word',
      wordCount: 3,
      readingTimeMin: 1,
    });
    expect(m.title).toBe('JSON-LD Headline');
    expect(m.byline).toBe('LD Author');
    expect(m.siteName).toBe('LD Publisher');
    expect(m.lang).toBe('fr');
    expect(m.publishedTime).toBe('2026-07-01T08:00:00Z');
    expect(m.excerpt).toBe('LD desc');
  });

  it('falls through tiers when JSON-LD is absent: OG → Twitter → meta → <time> → Readability → <title>', () => {
    const html = `
<html lang="es"><head>
  <title>Fallback Title</title>
  <meta property="og:title" content="OG Title">
  <meta property="og:site_name" content="OG Site">
  <meta property="article:published_time" content="2026-01-01T00:00:00Z">
  <meta property="article:author" content="OG Author">
  <meta property="og:description" content="OG desc">
</head><body><article><h1>OG Title</h1></article></body></html>`;
    const m = resolveMetadata({
      document: doc(html),
      readability: { title: 'R Title', byline: 'R Byline' },
      url: 'https://example.com/page',
      textContent: '',
      wordCount: 0,
      readingTimeMin: 0,
    });
    expect(m.title).toBe('OG Title');
    expect(m.byline).toBe('OG Author');
    expect(m.siteName).toBe('OG Site');
    expect(m.publishedTime).toBe('2026-01-01T00:00:00Z');
    expect(m.lang).toBe('es');
  });

  it('uses <title> and <html lang> as the last resort when nothing richer is present', () => {
    const html = `<html lang="ja"><head><title>Bare Title</title></head><body><p>hi</p></body></html>`;
    const m = resolveMetadata({
      document: doc(html),
      readability: null,
      url: undefined,
      textContent: 'hi',
      wordCount: 1,
      readingTimeMin: 1,
    });
    expect(m.title).toBe('Bare Title');
    expect(m.lang).toBe('ja');
    expect(m.byline).toBeUndefined();
  });

  it('parses JSON-LD arrays and @graph, and joins multiple authors', () => {
    const html = `
<html><head>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@graph":[
    {"@type":"BlogPosting","headline":"Graph Post",
     "author":[{"name":"Alpha"},{"name":"Beta"}],
     "datePublished":"2026-06-01T00:00:00Z","description":"graph desc"}
  ]}
  </script>
</head><body></body></html>`;
    const m = resolveMetadata({
      document: doc(html),
      readability: null,
      url: undefined,
      textContent: '',
      wordCount: 0,
      readingTimeMin: 0,
    });
    expect(m.title).toBe('Graph Post');
    expect(m.byline).toBe('Alpha, Beta');
    expect(m.publishedTime).toBe('2026-06-01T00:00:00Z');
  });

  it('skips malformed JSON-LD without throwing', () => {
    const html = `<html><head>
      <script type="application/ld+json">{ not valid json</script>
      <title>Safe Title</title>
    </head><body></body></html>`;
    const m = resolveMetadata({
      document: doc(html),
      readability: null,
      url: undefined,
      textContent: '',
      wordCount: 0,
      readingTimeMin: 0,
    });
    expect(m.title).toBe('Safe Title');
  });
});

describe('policy.metadata token estimate', () => {
  function resolveWith(textContent: string) {
    return resolveMetadata({
      document: doc('<html><body></body></html>'),
      readability: null,
      url: undefined,
      textContent,
      wordCount: 0,
      readingTimeMin: 0,
    });
  }

  it('estimates prose textContent at chars/4', () => {
    const textContent = 'The quick brown fox jumps over the lazy dog near the riverbank.';
    const m = resolveWith(textContent);
    expect(m.tokenEstimate).toBe(Math.round(textContent.length / 4));
    expect(m.estimator).toBe('chars/4');
  });

  it('estimates code-heavy textContent at chars/4', () => {
    const textContent = 'const x = (a, b) => a + b; console.log(x(1, 2)); // 3';
    const m = resolveWith(textContent);
    expect(m.tokenEstimate).toBe(Math.round(textContent.length / 4));
    expect(m.estimator).toBe('chars/4');
  });

  it('estimates empty textContent as zero', () => {
    const m = resolveWith('');
    expect(m.tokenEstimate).toBe(0);
    expect(m.estimator).toBe('chars/4');
  });
});

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
