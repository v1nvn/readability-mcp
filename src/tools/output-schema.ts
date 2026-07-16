// Zod OUTPUT schema for `structuredContent`. The SDK validates the handler's
// `structuredContent` against this shape, so every field the handler returns
// must validate here. Exported as both the raw shape (for the SDK
// `outputSchema`) and a wrapped object (for in-process assertions/tests).
//
// The rendered payload (`content`) is mirrored into `structuredContent` on
// purpose: when a tool declares an `outputSchema`, MCP clients (including
// Claude Code) surface `structuredContent` and drop the `content` text array,
// so the article must live here to reach the model. The `content[0].text`
// array stays in the CallToolResult for clients that consume it directly.

import { z } from 'zod';

export const outputSchemaShape = {
  schemaVersion: z.literal(1),
  content: z.string(),
  metadata: z.object({
    byline: z.string().optional(),
    excerpt: z.string().optional(),
    lang: z.string().optional(),
    publishedTime: z.string().optional(),
    readingTimeMin: z.number().int().optional(),
    siteName: z.string().optional(),
    title: z.string().optional(),
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

// Output schema for the `outline` tool. A flat list of headings plus a rendered
// TOC in `content`; no diagnostics object because the outline walk has no
// extraction/sanitization stages to report on. Mirrors the shared shape
// (`schemaVersion` + `content` + `metadata`) so clients can treat all three
// tools uniformly.
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
