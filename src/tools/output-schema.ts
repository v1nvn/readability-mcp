import { z } from 'zod';

// Shared between `extract` and `extract_metadata` outputs so the metadata
// cascade has one shape across tools. wordCount/readingTimeMin/tokenEstimate
// are optional here — extract_metadata omits them; extract populates them.
const metadataObjectSchema = z
  .object({
    byline: z
      .string()
      .optional()
      .describe(
        'Article author(s), resolved from JSON-LD, OpenGraph, <meta>, or Readability.',
      ),
    canonical: z
      .string()
      .optional()
      .describe(
        'Declared canonical URL from <link rel="canonical"> (or og:url as fallback). Distinct from url, which is the origin context passed in.',
      ),
    estimator: z
      .string()
      .optional()
      .describe(
        'Name of the heuristic backing tokenEstimate (e.g. "chars/4").',
      ),
    excerpt: z
      .string()
      .optional()
      .describe('Short article summary produced by Readability.'),
    lang: z.string().optional().describe('Detected document language.'),
    publishedTime: z
      .string()
      .optional()
      .describe(
        'Publication timestamp resolved from JSON-LD, <meta>, or <time> elements.',
      ),
    readingTimeMin: z
      .number()
      .int()
      .optional()
      .describe(
        'Estimated reading time in minutes, derived from wordCount and wordsPerMinute.',
      ),
    siteName: z
      .string()
      .optional()
      .describe('Publishing site name, resolved from OpenGraph or <meta>.'),
    structured: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Parsed schema.org JSON-LD primary object (Recipe/Product/Event/HowTo/Article…) when present — the raw graph node with @context stripped and @type normalized to a "+"-joined string. Absent when the page has no recognizable structured data.',
      ),
    title: z
      .string()
      .optional()
      .describe(
        'Article title, resolved by priority cascade (JSON-LD → OpenGraph → Twitter → <meta> → Readability → <title>).',
      ),
    tokenEstimate: z
      .number()
      .int()
      .optional()
      .describe(
        'Rough output token count (chars/4 by default) for context budgeting.',
      ),
    url: z.string().optional().describe('The url passed in (origin context).'),
    wordCount: z
      .number()
      .int()
      .optional()
      .describe('Number of whitespace-separated words in the extracted text.'),
  })
  .describe(
    'Resolved article metadata. Each field is the first non-empty value across a priority cascade.',
  );

export const chunkObjectSchema = z
  .object({
    index: z
      .number()
      .int()
      .min(0)
      .describe('Zero-based chunk position within the emitted sequence.'),
    text: z
      .string()
      .describe(
        'The chunk body (markdown or text), trimmed, sized to stay within the requested token budget.',
      ),
    tokenCount: z
      .number()
      .int()
      .min(0)
      .describe(
        'Estimated token count of text (chars/4), same heuristic as metadata.tokenEstimate.',
      ),
    headingContext: z
      .string()
      .describe(
        'Nearest preceding markdown heading text in effect at the chunk’s first block. Empty string when the chunk precedes any heading; carried from the overlap source when a chunk begins with overlap text.',
      ),
  })
  .describe(
    'One token-bounded slice of the extracted markdown, with its section heading for context.',
  );

export const imageEntrySchema = z
  .object({
    src: z
      .string()
      .describe('Absolute (resolved) image URL, absolutized against url.'),
    alt: z
      .string()
      .describe('The img alt attribute, or empty string when absent.'),
    width: z
      .number()
      .int()
      .optional()
      .describe('Pixel dimension from the attribute, when present.'),
    height: z
      .number()
      .int()
      .optional()
      .describe('Pixel dimension from the attribute, when present.'),
    caption: z
      .string()
      .describe('figcaption text from the enclosing <figure>, else alt.'),
  })
  .describe('One extracted image with resolved source and caption.');

export const outputSchemaShape = {
  schemaVersion: z
    .literal(1)
    .describe(
      'Structured-content schema version. Bumps only on breaking shape changes to this object.',
    ),
  content: z
    .string()
    .describe(
      'The human/LLM-readable payload — Markdown/html/text, or the serialized JSON when format=json.',
    ),
  chunks: z
    .array(chunkObjectSchema)
    .optional()
    .describe(
      'Token-bounded chunks of the extracted markdown, populated by `extract` only when the `chunk` option is set and the format yields a markdown/text body. Absent for html_to_markdown and for html/json extract formats.',
    ),
  images: z
    .array(imageEntrySchema)
    .optional()
    .describe(
      'Inventory of article images (absolute src, alt, dimensions, caption); populated only when imageInventory:true is passed to extract.',
    ),
  metadata: metadataObjectSchema,
  diagnostics: z
    .object({
      boilerplateRemoved: z
        .number()
        .int()
        .optional()
        .describe(
          'Count of boilerplate blocks (related-posts, newsletter signup, read-next) stripped before conversion.',
        ),
      chromeRemoved: z
        .number()
        .int()
        .optional()
        .describe(
          'Count of browser-chrome nodes stripped before conversion (scrollbars, consent banners, overlays).',
        ),
      extractedNode: z
        .string()
        .optional()
        .describe(
          'DOM root extraction came from: "readability" (main path), a fallback selector (e.g. "article", "main"), or "fragment" for html_to_markdown.',
        ),
      fallbackUsed: z
        .boolean()
        .describe(
          'True if Readability parse failed and a selector cascade salvaged content. Always true for html_to_markdown.',
        ),
      gated: z
        .object({
          likely: z
            .boolean()
            .describe(
              'True when heuristics strongly suggest the content is paywalled or truncated.',
            ),
          reason: z
            .string()
            .describe(
              'Short label naming the detected signal (e.g. "paywall overlay", "metered paywall message").',
            ),
        })
        .optional()
        .describe(
          'Likely paywall / gating signal. The extraction may be partial; the host can re-capture after authenticating. Detection only — this server never fetches or authenticates.',
        ),
      imagesResolved: z
        .number()
        .int()
        .optional()
        .describe(
          'Count of lazy/placeholder images resolved to their real src before conversion.',
        ),
      pagination: z
        .object({
          type: z
            .enum(['infinite', 'paginated'])
            .describe('Kind of pagination signal detected in the document.'),
          nextUrl: z
            .string()
            .optional()
            .describe(
              'Absolute URL of the detected next page (paginated only). Mirrors the href found in the DOM; never fetched by this server.',
            ),
          selector: z
            .string()
            .optional()
            .describe(
              'CSS selector of the detected load-more / infinite-scroll sentinel (infinite only).',
            ),
        })
        .optional()
        .describe(
          'Detected pagination or infinite-scroll signal. Detection only — the host drives loading; this server never fetches.',
        ),
      readerable: z
        .boolean()
        .optional()
        .describe(
          'Readability isProbablyReaderable verdict on the document (extract main path only).',
        ),
      removedNodes: z
        .number()
        .int()
        .optional()
        .describe(
          'Net element count removed across the whole pipeline (delta vs. the parsed document).',
        ),
      sanitization: z
        .object({
          iframes: z
            .number()
            .int()
            .describe('<iframe> elements removed by sanitization.'),
          scripts: z
            .number()
            .int()
            .describe(
              '<script> and event-handler nodes removed by sanitization.',
            ),
        })
        .optional()
        .describe('Counts of nodes removed by DOMPurify sanitization.'),
      truncated: z
        .boolean()
        .describe('True if the payload was truncated by maxChars.'),
      trace: z
        .array(
          z
            .object({
              stage: z
                .string()
                .describe(
                  'Pipeline stage name (e.g. "normalize", "readability", "sanitize", "turndown", "metadata").',
                ),
              ms: z
                .number()
                .describe(
                  'Wall-clock duration of the stage in milliseconds, measured via performance.now().',
                ),
            })
            .describe('One timed pipeline stage.'),
        )
        .optional()
        .describe(
          'Per-stage timings emitted only when debug:true is passed to extract/html_to_markdown. Stages are non-overlapping and ordered; absent otherwise.',
        ),
    })
    .describe(
      'Pipeline telemetry describing what was extracted, sanitized, and removed.',
    ),
} as const;

export const outputSchema = z.object(outputSchemaShape);

export type StructuredContent = z.infer<typeof outputSchema>;

export const outlineOutputShape = {
  schemaVersion: z
    .literal(1)
    .describe(
      'Structured-content schema version. Bumps only on breaking shape changes to this object.',
    ),
  content: z
    .string()
    .describe(
      'Indented-bullet table of contents, one line per heading, nested by depth.',
    ),
  outline: z
    .array(
      z
        .object({
          level: z
            .number()
            .int()
            .min(1)
            .max(6)
            .describe('Heading level (1–6).'),
          text: z.string().describe('Heading text content.'),
          anchor: z
            .string()
            .describe(
              'Stable anchor id: the heading own id, a descendant permalink fragment, or a slug of the text (deduped -1, -2, … for generated slugs).',
            ),
        })
        .describe('A single document heading with its stable anchor.'),
    )
    .describe(
      'Document headings (h1–h6) in document order, each with a stable anchor id.',
    ),
  metadata: z
    .object({
      title: z
        .string()
        .optional()
        .describe(
          'Document title from <title>, falling back to the first <h1>.',
        ),
      url: z
        .string()
        .optional()
        .describe('The url passed in (origin context, never fetched).'),
    })
    .describe('Outline document metadata.'),
} as const;

export const outlineOutput = z.object(outlineOutputShape);

export type OutlineStructuredContent = z.infer<typeof outlineOutput>;

export const extractMetadataOutputShape = {
  schemaVersion: z
    .literal(1)
    .describe(
      'Structured-content schema version. Bumps only on breaking shape changes to this object.',
    ),
  content: z
    .string()
    .describe(
      'Human-readable key:value rendering of the metadata block, so content[0].text is never empty.',
    ),
  metadata: metadataObjectSchema,
} as const;

export const extractMetadataOutput = z.object(extractMetadataOutputShape);

export type ExtractMetadataStructuredContent = z.infer<
  typeof extractMetadataOutput
>;

export const chunkTextOutputShape = {
  schemaVersion: z
    .literal(1)
    .describe(
      'Structured-content schema version. Bumps only on breaking shape changes to this object.',
    ),
  content: z
    .string()
    .describe(
      'Readable index of the chunks (one numbered section per chunk, each prefixed with its heading context), so content[0].text is always scannable.',
    ),
  chunks: z
    .array(chunkObjectSchema)
    .describe(
      'The emitted chunks in order. Empty array when the input contains no non-whitespace content.',
    ),
} as const;

export const chunkTextOutput = z.object(chunkTextOutputShape);

export type ChunkTextStructuredContent = z.infer<typeof chunkTextOutput>;

export const linkObjectSchema = z
  .object({
    text: z
      .string()
      .describe(
        'Anchor text content, whitespace-collapsed and trimmed (capped at 300 chars).',
      ),
    href: z
      .string()
      .describe(
        'Absolute href (resolved against url when provided); unchanged when url is absent or the pair fails to parse.',
      ),
    rel: z
      .string()
      .describe(
        'The raw rel attribute value (e.g. "noopener noreferrer", "nofollow"), or the empty string when absent.',
      ),
    isExternal: z
      .boolean()
      .describe(
        'True when url is provided and the href parses to a different origin than url. False for relative, fragment, same-origin, non-http(s) (mailto/tel/javascript), and malformed hrefs.',
      ),
  })
  .describe(
    'A single anchor link with its text, absolute href, rel, and origin.',
  );

export const extractLinksOutputShape = {
  schemaVersion: z
    .literal(1)
    .describe(
      'Structured-content schema version. Bumps only on breaking shape changes to this object.',
    ),
  content: z
    .string()
    .describe(
      'Readable rendering of the link list (one `- [text](href)` line per link), so content[0].text is never empty.',
    ),
  links: z
    .array(linkObjectSchema)
    .describe(
      'Anchors in document order, hrefs absolutized against url. No deduplication.',
    ),
  metadata: z
    .object({
      url: z
        .string()
        .optional()
        .describe('The url passed in (origin context, never fetched).'),
    })
    .describe('Extract-links document metadata.'),
} as const;

export const extractLinksOutput = z.object(extractLinksOutputShape);

export type ExtractLinksStructuredContent = z.infer<typeof extractLinksOutput>;
