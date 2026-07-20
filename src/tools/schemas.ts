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

export const localPathField = z
  .string()
  .describe(
    'Absolute or relative path to a file holding the already-rendered (post-JavaScript) HTML to process, e.g. `document.documentElement.outerHTML` written to disk by a browser/devtools capture. Read by the server so the page bytes never enter the model context — only this path string does. Resolved relative to the server process working directory; the server makes no outbound requests.',
  );

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

export const chunkStrategySchema = z.enum(['char', 'semantic']);

export const chunkOptionsSchema = z
  .object({
    maxTokens: z
      .number()
      .int()
      .min(1)
      .describe(
        'Per-chunk token budget. Each chunk.text is sized so Math.round(text.length/4) stays within this bound (hard cap; oversized blocks are split by line, then hard-split).',
      ),
    overlap: z
      .number()
      .int()
      .min(0)
      .describe(
        'Tokens to overlap between consecutive chunks (>=0). The trailing overlapChars of chunk N becomes the leading context of chunk N+1, preserving cross-chunk coherence at a cost of redundant tokens.',
      )
      .default(0),
    strategy: chunkStrategySchema
      .describe(
        "Chunking strategy. 'semantic' (default) breaks on heading/section boundaries and never splits a fenced code block; 'char' greedily groups blank-line-separated blocks under a chars/4 token budget (may split a code block).",
      )
      .default('semantic'),
  })
  .describe(
    'Token-bounded chunking options for splitting the extracted markdown into RAG/embedding-ready slices.',
  );

export const turndownOptionsShape = {
  debug: z
    .boolean()
    .describe(
      'Emit per-stage timings (normalize, readability, sanitize, turndown, metadata) under diagnostics.trace. Debug-only — leaves trace absent by default.',
    )
    .default(false),
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
  baseUrl: z
    .url()
    .describe(
      'Base URL for absolutizing relative links and images. NEVER fetched — origin context only.',
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
  localPath: localPathField,
  ...turndownOptionsShape,

  cache: z
    .boolean()
    .describe(
      'When true, cache the result keyed by a normalized hash of the HTML plus the output-affecting options; repeat calls with the same normalized HTML hit the cache and report diagnostics.cache (hit/miss + both hashes). The cache is in-memory and bounded; entries are also exposed as readability://page/{hash} resources.',
    )
    .default(false),
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
  chunk: chunkOptionsSchema
    .optional()
    .describe(
      'Split the extracted markdown into token-bounded chunks (RAG/embedding-ready). When set, structuredContent.chunks is populated. Only applies to format:"markdown" | "text"; HTML/JSON payloads carry no markdown body to slice and leave chunks unset.',
    ),
  imageInventory: z
    .boolean()
    .describe(
      'Emit structuredContent.images: a list of {src (absolute, resolved), alt, width?, height?, caption} for every <img> in the extracted article. Independent of the `images` option (which governs inline rendering). Placeholders are skipped.',
    )
    .default(false),
} as const;

export const extractInputSchema = z.object(extractInputShape);

export const htmlToMarkdownInputShape = {
  localPath: localPathField,
  ...turndownOptionsShape,
  selectors: selectorsSchema,
} as const;

export const htmlToMarkdownInputSchema = z.object(htmlToMarkdownInputShape);

export const outlineInputShape = {
  localPath: localPathField,
  baseUrl: z
    .url()
    .describe(
      'Base URL, carried through to metadata.baseUrl and used to absolutize links. NEVER fetched — origin context only.',
    )
    .optional(),
  selectors: selectorsSchema,
} as const;

export const outlineInputSchema = z.object(outlineInputShape);

export const extractMetadataInputShape = {
  localPath: localPathField,
  baseUrl: z
    .url()
    .describe(
      'Base URL, carried through to metadata.baseUrl and used to absolutize links. NEVER fetched — origin context only.',
    )
    .optional(),
} as const;

export const extractMetadataInputSchema = z.object(extractMetadataInputShape);

export const extractLinksInputShape = {
  localPath: localPathField,
  baseUrl: z
    .url()
    .describe(
      'Base URL for absolutizing relative hrefs and computing isExternal. NEVER fetched — origin context only.',
    )
    .optional(),
  sameOriginOnly: z
    .boolean()
    .describe(
      'Drop cross-origin links; keep same-origin, relative, and fragment links.',
    )
    .default(false),
  selectors: selectorsSchema,
} as const;

export const extractLinksInputSchema = z.object(extractLinksInputShape);

export const chunkTextInputShape = {
  text: z
    .string()
    .describe(
      'Already-extracted text to split (e.g. markdown from `extract` or any plain text). No HTML parsing or Readability scoring is applied — the input is chunked verbatim.',
    ),
  maxTokens: z
    .number()
    .int()
    .min(1)
    .describe(
      'Per-chunk token budget. Each chunk.text is sized so Math.round(text.length/4) stays within this bound (hard cap; oversized blocks are split by line, then hard-split).',
    )
    .default(500),
  overlap: z
    .number()
    .int()
    .min(0)
    .describe(
      'Tokens to overlap between consecutive chunks (>=0). The trailing overlapChars of chunk N becomes the leading context of chunk N+1.',
    )
    .default(0),
  strategy: chunkStrategySchema
    .describe(
      "Chunking strategy. 'semantic' (default) breaks on heading/section boundaries and never splits a fenced code block; 'char' greedily groups blank-line-separated blocks under a chars/4 token budget.",
    )
    .default('semantic'),
} as const;

export const chunkTextInputSchema = z.object(chunkTextInputShape);

export const extractSectionInputShape = {
  localPath: localPathField,
  baseUrl: z
    .url()
    .describe(
      'Base URL for absolutizing relative links and images. NEVER fetched — origin context only.',
    )
    .optional(),
  selector: z
    .string()
    .describe(
      'CSS selector scoping extraction to one subtree; passed straight through as selectors.include. Provide exactly one of selector/heading.',
    )
    .optional(),
  heading: z
    .string()
    .describe(
      'Heading text selecting one section; the section spans from this heading to the next same-or-higher-level heading. Case-insensitive; first match wins. Provide exactly one of selector/heading.',
    )
    .optional(),
} as const;

export const extractSectionInputSchema = z
  .object(extractSectionInputShape)
  .superRefine((value, ctx) => {
    const hasSelector = value.selector !== undefined;
    const hasHeading = value.heading !== undefined;
    if (hasSelector === hasHeading) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Provide exactly one of `selector` or `heading` (both set or both unset is invalid).',
        path: ['selector'],
      });
    }
  });

export const extractTablesInputShape = {
  localPath: localPathField,
  baseUrl: z
    .url()
    .describe(
      'Base URL, carried through to metadata.baseUrl. NEVER fetched — origin context only.',
    )
    .optional(),
  format: tableFormatSchema
    .describe(
      'Output format for every table: "gfm" (default — native GFM table with a delimiter row), "csv" (RFC-4180-ish, quoted fields), or "json" (array of row objects keyed by the header row).',
    )
    .default('gfm'),
  selectors: selectorsSchema,
} as const;

export const extractTablesInputSchema = z.object(extractTablesInputShape);

export const extractListInputShape = {
  localPath: localPathField,
  baseUrl: z
    .url()
    .describe(
      'Base URL for absolutizing item hrefs against. NEVER fetched — origin context only.',
    )
    .optional(),
  selectors: selectorsSchema,
} as const;

export const extractListInputSchema = z.object(extractListInputShape);

export type ChunkTextInput = z.infer<typeof chunkTextInputSchema>;
export type ExtractInput = z.infer<typeof extractInputSchema>;
export type ExtractLinksInput = z.infer<typeof extractLinksInputSchema>;
export type ExtractListInput = z.infer<typeof extractListInputSchema>;
export type ExtractMetadataInput = z.infer<typeof extractMetadataInputSchema>;
export type ExtractSectionInput = z.infer<typeof extractSectionInputSchema>;
export type ExtractTablesInput = z.infer<typeof extractTablesInputSchema>;
export type HtmlToMarkdownInput = z.infer<typeof htmlToMarkdownInputSchema>;
export type OutlineInput = z.infer<typeof outlineInputSchema>;
export type Selectors = z.infer<typeof selectorsSchema>;

// A worker takes the same fields as its public schema minus `localPath`, plus
// the already-resolved `html` string. The option fields are all optional here:
// the public fn hands a fully-defaulted object (it parsed the schema), while
// internal callers (the CLI, extract_section, tests) pass only what they care
// about and the worker merges schema defaults for the rest. Tools whose schema
// has no `.default()` fields have nothing to merge.
export type FromHtmlInput<T> = Partial<Omit<T, 'localPath'>> & { html: string };

export type ExtractFromHtmlInput = FromHtmlInput<ExtractInput>;
export type HtmlToMarkdownFromHtmlInput = FromHtmlInput<HtmlToMarkdownInput>;
export type OutlineFromHtmlInput = FromHtmlInput<OutlineInput>;
export type ExtractLinksFromHtmlInput = FromHtmlInput<ExtractLinksInput>;
export type ExtractListFromHtmlInput = FromHtmlInput<ExtractListInput>;
export type ExtractMetadataFromHtmlInput = FromHtmlInput<ExtractMetadataInput>;
export type ExtractSectionFromHtmlInput = FromHtmlInput<ExtractSectionInput>;
export type ExtractTablesFromHtmlInput = FromHtmlInput<ExtractTablesInput>;
