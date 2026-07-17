import { z } from 'zod';

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
  metadata: z
    .object({
      byline: z
        .string()
        .optional()
        .describe(
          'Article author(s), resolved from JSON-LD, OpenGraph, <meta>, or Readability.',
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
      url: z
        .string()
        .optional()
        .describe(
          'The url passed in (origin context), or the article canonical URL when discoverable.',
        ),
      wordCount: z
        .number()
        .int()
        .optional()
        .describe(
          'Number of whitespace-separated words in the extracted text.',
        ),
    })
    .describe(
      'Resolved article metadata. Each field is the first non-empty value across a priority cascade.',
    ),
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
      imagesResolved: z
        .number()
        .int()
        .optional()
        .describe(
          'Count of lazy/placeholder images resolved to their real src before conversion.',
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
