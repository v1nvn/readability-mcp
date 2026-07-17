import { z } from 'zod';

export const formatSchema = z.enum(['html', 'json', 'markdown', 'text']);
export const metadataModeSchema = z.enum(['json', 'none', 'yaml']);
export const extractionSchema = z.enum([
  'aggressive',
  'balanced',
  'conservative',
]);
export const headingStyleSchema = z.enum(['atx', 'setext']);
export const codeBlockStyleSchema = z.enum(['fenced', 'indented']);
export const imageModeSchema = z.enum([
  'drop',
  'keep',
  'reference',
  'src-only',
]);
export const tableFormatSchema = z.enum(['csv', 'gfm', 'json']);

export const selectorsSchema = z
  .object({
    include: z
      .string()
      .optional()
      .describe(
        'CSS selector restricting extraction to a matching subtree (e.g. "main", "article", ".post"). The first match replaces the document body before processing.',
      ),
    exclude: z
      .array(z.string())
      .optional()
      .describe(
        'CSS selectors for boilerplate to remove before extraction (e.g. ["nav", "footer", "[role=banner]"]).',
      ),
  })
  .optional()
  .describe(
    'Scope the extracted/converted content by CSS selector before processing.',
  );

export const readabilityOverridesSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    'Escape hatch: a record spread verbatim into the Readability options. Unstable and unvalidated; overrides the extraction/keepClasses/maxNodes/minArticleLength knobs.',
  );

export const turndownOptionsShape = {
  cleanChrome: z
    .boolean()
    .describe(
      'Strip browser chrome (scrollbars, consent/cookie banners, fixed nav and overlays) before conversion. These elements poison Readability density scoring and clutter fragment output.',
    )
    .default(true),
  codeBlockStyle: codeBlockStyleSchema
    .describe(
      "Markdown code-block style: 'fenced' (triple backticks) or 'indented' (four-space).",
    )
    .default('fenced'),
  format: formatSchema
    .describe(
      "Returned payload format: 'markdown' (default), 'html', 'text', or 'json' (emits {metadata, content, diagnostics}).",
    )
    .default('markdown'),
  gfm: z
    .boolean()
    .describe(
      'Enable GitHub-Flavored Markdown: tables, strikethrough, and task lists.',
    )
    .default(true),
  headingStyle: headingStyleSchema
    .describe(
      "Markdown heading style: 'atx' (#) or 'setext' (underlining with = / -).",
    )
    .default('atx'),
  images: imageModeSchema
    .describe(
      "Image handling: 'keep' (inline ![alt](url)), 'drop', 'src-only' (bare URL text), or 'reference' (link-reference style).",
    )
    .default('keep'),
  maxChars: z
    .number()
    .int()
    .min(0)
    .describe(
      'Truncate markdown/text output at a block boundary; never splits a fenced code block. Ignored for html/json formats.',
    )
    .optional(),
  metadataMode: metadataModeSchema
    .describe(
      "Prepend a metadata block to the markdown/text payload: 'none' (default), 'yaml', or 'json'.",
    )
    .default('none'),
  sanitize: z
    .boolean()
    .describe(
      'Run DOMPurify over the extracted/fragment HTML before conversion (strips scripts, event handlers, and iframes).',
    )
    .default(true),
  tables: tableFormatSchema
    .describe(
      'Render <table> elements via a rowspan/colspan-aware matrix: "gfm" (default native GFM table), "csv" (RFC-4180-ish code block), or "json" (array of row objects keyed by the header). When unset, tables pass through Turndown\'s native rule unchanged.',
    )
    .optional(),
  // zod v4 renamed `z.string().url()` to `z.url()`.
  url: z
    .url()
    .describe(
      'Origin URL for absolutizing relative links and images. NEVER fetched — origin context only.',
    )
    .optional(),
  wordsPerMinute: z
    .number()
    .int()
    .min(1)
    .describe(
      'Reading speed (words per minute) used to compute metadata.readingTimeMin.',
    )
    .default(200),
} as const;

export const extractInputShape = {
  html: z
    .string()
    .describe(
      'Already-rendered HTML (post-JavaScript), e.g. the result of document.documentElement.outerHTML from a browser/devtools capture. This is the ONLY input the server reads; it makes no outbound requests.',
    ),
  ...turndownOptionsShape,

  extraction: extractionSchema
    .describe(
      "Readability scoring aggressiveness: 'balanced' (default), 'aggressive', or 'conservative'. Maps to Readability's scorer knobs.",
    )
    .default('balanced'),
  keepClasses: z
    .boolean()
    .describe(
      'Retain all CSS classes on extracted nodes. Defaults false, which strips non-language classes.',
    )
    .default(false),
  maxNodes: z
    .number()
    .int()
    .min(0)
    .describe(
      'Hard cap on elements parsed (Readability maxElemsToParse). Safety/perf guard for very large documents.',
    )
    .optional(),
  minArticleLength: z
    .number()
    .int()
    .min(0)
    .describe(
      'Minimum article character length below which extraction falls back to the selector cascade (Readability charThreshold).',
    )
    .optional(),
  readabilityOverrides: readabilityOverridesSchema,
  selectors: selectorsSchema,
} as const;

export const extractInputSchema = z.object(extractInputShape);

export const htmlToMarkdownInputShape = {
  html: z
    .string()
    .describe(
      'HTML fragment to convert to Markdown. No Readability article scoring is applied — the fragment is normalized and converted as-is.',
    ),
  ...turndownOptionsShape,
  selectors: selectorsSchema,
} as const;

export const htmlToMarkdownInputSchema = z.object(htmlToMarkdownInputShape);

export const outlineInputShape = {
  html: z
    .string()
    .describe(
      'Already-rendered HTML (post-JavaScript) to walk for headings. No Readability scoring, Turndown, or sanitization is applied.',
    ),
  url: z
    .url()
    .describe(
      'Origin URL, carried through to metadata.url and used to absolutize links. NEVER fetched — origin context only.',
    )
    .optional(),
} as const;

export const outlineInputSchema = z.object(outlineInputShape);

export const extractMetadataInputShape = {
  html: z
    .string()
    .describe(
      'Already-rendered HTML (post-JavaScript) to resolve bibliographic metadata from. No Readability scoring, Turndown, or sanitization is applied — only <title>, <meta>, <link rel="canonical">, and JSON-LD are read.',
    ),
  url: z
    .url()
    .describe(
      'Origin URL, carried through to metadata.url and used to absolutize links. NEVER fetched — origin context only.',
    )
    .optional(),
} as const;

export const extractMetadataInputSchema = z.object(extractMetadataInputShape);

export type ExtractInput = z.infer<typeof extractInputSchema>;
export type ExtractMetadataInput = z.infer<typeof extractMetadataInputSchema>;
export type HtmlToMarkdownInput = z.infer<typeof htmlToMarkdownInputSchema>;
export type OutlineInput = z.infer<typeof outlineInputSchema>;
export type Selectors = z.infer<typeof selectorsSchema>;
