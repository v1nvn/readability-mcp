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
  metadata: metadataObjectSchema,
  diagnostics: z
    .object({
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
