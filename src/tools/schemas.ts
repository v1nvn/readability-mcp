// Zod INPUT schemas — the single source of truth for tool arguments
// (DESIGN §5.1). The MCP SDK takes a *raw shape* (`Record<string, ZodType>`,
// not `z.object(...)`), so each tool exports its shape; `extractArticle` also
// wraps the shape in `z.object` to parse/apply defaults internally.
//
// `turndownOptionsShape` is the subset shared with the future html_to_markdown
// tool (DESIGN §5.2); `extractInputShape` composes it with the extraction knobs.

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

export const selectorsSchema = z
  .object({
    // Restrict extraction to a subtree ("main", "article", ".post").
    include: z.string().optional(),
    // Strip boilerplate nodes ("nav", "footer", "[role=banner]") before Readability.
    exclude: z.array(z.string()).optional(),
  })
  .optional();

// Escape hatch: passed verbatim into `new Readability(doc, {...})`. Documented
// as implementation-specific and unstable (DESIGN §5.3).
export const readabilityOverridesSchema = z
  .record(z.string(), z.unknown())
  .optional();

export const turndownOptionsShape = {
  codeBlockStyle: codeBlockStyleSchema.default('fenced'),
  format: formatSchema.default('markdown'),
  gfm: z.boolean().default(true),
  headingStyle: headingStyleSchema.default('atx'),
  images: imageModeSchema.default('keep'),
  // Block-boundary truncation (Phase C guarantees no mid-code-fence cut).
  maxChars: z.number().int().min(0).optional(),
  metadataMode: metadataModeSchema.default('none'),
  // Phase B: sanitize is always on by default; off only when caller opts out.
  sanitize: z.boolean().default(true),
  // Turndown needs the origin to resolve relative links/images in output.
  // zod v4 renamed `z.string().url()` to `z.url()`.
  url: z.url().optional(),
  wordsPerMinute: z.number().int().min(1).default(200),
} as const;

export const extractInputShape = {
  html: z.string(),
  ...turndownOptionsShape,

  extraction: extractionSchema.default('balanced'),
  keepClasses: z.boolean().default(false),
  // Perf/safety cap = Readability maxElemsToParse.
  maxNodes: z.number().int().min(0).optional(),
  // Semantic alias for Readability charThreshold.
  minArticleLength: z.number().int().min(0).optional(),
  readabilityOverrides: readabilityOverridesSchema,
  selectors: selectorsSchema,
} as const;

export const extractInputSchema = z.object(extractInputShape);

// `html_to_markdown` (DESIGN §5.2) converts an arbitrary fragment WITHOUT
// Readability scoring. It shares the turndown option surface (so callers get a
// consistent format/gfm/images/... vocabulary across both tools) plus selector
// pruning, but carries no extraction knobs.
export const htmlToMarkdownInputShape = {
  html: z.string(),
  ...turndownOptionsShape,
  selectors: selectorsSchema,
} as const;

export const htmlToMarkdownInputSchema = z.object(htmlToMarkdownInputShape);

export type ExtractInput = z.infer<typeof extractInputSchema>;
export type HtmlToMarkdownInput = z.infer<typeof htmlToMarkdownInputSchema>;
export type Selectors = z.infer<typeof selectorsSchema>;
