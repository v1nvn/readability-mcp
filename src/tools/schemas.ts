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
    include: z.string().optional(),
    exclude: z.array(z.string()).optional(),
  })
  .optional();

export const readabilityOverridesSchema = z
  .record(z.string(), z.unknown())
  .optional();

export const turndownOptionsShape = {
  cleanChrome: z.boolean().default(true),
  codeBlockStyle: codeBlockStyleSchema.default('fenced'),
  format: formatSchema.default('markdown'),
  gfm: z.boolean().default(true),
  headingStyle: headingStyleSchema.default('atx'),
  images: imageModeSchema.default('keep'),
  maxChars: z.number().int().min(0).optional(),
  metadataMode: metadataModeSchema.default('none'),
  sanitize: z.boolean().default(true),
  // zod v4 renamed `z.string().url()` to `z.url()`.
  url: z.url().optional(),
  wordsPerMinute: z.number().int().min(1).default(200),
} as const;

export const extractInputShape = {
  html: z.string(),
  ...turndownOptionsShape,

  extraction: extractionSchema.default('balanced'),
  keepClasses: z.boolean().default(false),
  maxNodes: z.number().int().min(0).optional(),
  minArticleLength: z.number().int().min(0).optional(),
  readabilityOverrides: readabilityOverridesSchema,
  selectors: selectorsSchema,
} as const;

export const extractInputSchema = z.object(extractInputShape);

export const htmlToMarkdownInputShape = {
  html: z.string(),
  ...turndownOptionsShape,
  selectors: selectorsSchema,
} as const;

export const htmlToMarkdownInputSchema = z.object(htmlToMarkdownInputShape);

export const outlineInputShape = {
  html: z.string(),
  url: z.url().optional(),
} as const;

export const outlineInputSchema = z.object(outlineInputShape);

export type ExtractInput = z.infer<typeof extractInputSchema>;
export type HtmlToMarkdownInput = z.infer<typeof htmlToMarkdownInputSchema>;
export type OutlineInput = z.infer<typeof outlineInputSchema>;
export type Selectors = z.infer<typeof selectorsSchema>;
