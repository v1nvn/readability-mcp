// The CSS selector identifying the HUMAN main-content container in each bench
// fixture's saved.html. "Main content" is a human judgment — the selector names
// the element that IS the article (preferring <main>/<article> over
// header/nav/footer/aside), not whatever Readability happens to pick. Each value
// is paired with a self-contained rationale in MAIN_CONTENT_NOTES, and each is
// asserted to resolve to a non-null element by bench.test.ts.
export const MAIN_CONTENT_SELECTORS: Readonly<Record<string, string>> = {
  'code-langs': 'main article',
  'consent-banner': 'main article',
  'documentation': 'main article',
  'fallback': 'main',
  'lazy-images': 'main',
  'outline': 'main',
  'react-spa': 'main article',
};

export const MAIN_CONTENT_NOTES: Readonly<Record<string, string>> = {
  'code-langs':
    '<article> inside <main> holds the prose plus the canonicalized code blocks; <aside class="sidebar"> and the footer are chrome.',
  'consent-banner':
    '<article> inside <main> is the prose past the fixed header and the OneTrust banner; both are stripped before scoring.',
  'documentation':
    '<article> inside <main> holds the title, prose, and the two code blocks; nothing else on the page is content.',
  'fallback':
    '<main> is the image-only gallery — no prose, only alt text — so word-based precision/recall is degenerate (NaN) and the scorer excludes it from aggregates.',
  'lazy-images':
    '<main> carries the only prose plus the lazy <picture>/<img> demo; there is no <article> wrapper, so main is the tightest container.',
  'outline':
    '<main> carries the only prose; there is no <article> wrapper, so main is the tightest container.',
  'react-spa':
    '<article class="post"> inside <main class="content"> is the post; the sibling <aside class="sidebar"> (newsletter, related posts) is chrome.',
};
