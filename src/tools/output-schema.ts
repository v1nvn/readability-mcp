import { z } from 'zod';

export const outputSchemaShape = {
  schemaVersion: z.literal(1),
  content: z.string(),
  metadata: z.object({
    byline: z.string().optional(),
    estimator: z.string().optional(),
    excerpt: z.string().optional(),
    lang: z.string().optional(),
    publishedTime: z.string().optional(),
    readingTimeMin: z.number().int().optional(),
    siteName: z.string().optional(),
    title: z.string().optional(),
    tokenEstimate: z.number().int().optional(),
    url: z.string().optional(),
    wordCount: z.number().int().optional(),
  }),
  diagnostics: z.object({
    extractedNode: z.string().optional(),
    fallbackUsed: z.boolean(),
    imagesResolved: z.number().int().optional(),
    readerable: z.boolean().optional(),
    removedNodes: z.number().int().optional(),
    sanitization: z
      .object({
        iframes: z.number().int(),
        scripts: z.number().int(),
      })
      .optional(),
    truncated: z.boolean(),
  }),
} as const;

export const outputSchema = z.object(outputSchemaShape);

export type StructuredContent = z.infer<typeof outputSchema>;

export const outlineOutputShape = {
  schemaVersion: z.literal(1),
  content: z.string(),
  outline: z.array(
    z.object({
      level: z.number().int().min(1).max(6),
      text: z.string(),
      anchor: z.string(),
    }),
  ),
  metadata: z.object({
    title: z.string().optional(),
    url: z.string().optional(),
  }),
} as const;

export const outlineOutput = z.object(outlineOutputShape);

export type OutlineStructuredContent = z.infer<typeof outlineOutput>;
