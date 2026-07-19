import { z } from 'zod';

import type { ExplainReport } from '../policy/explain.js';
import type { ToolHandle } from '../server.js';

import { toErrorResult } from '../errors.js';
import { logger } from '../logger.js';
import { buildExplainReport } from '../policy/explain.js';
import { selectorsSchema } from './schemas.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Schemas live with the tool rather than in schemas.ts/output-schema.ts to keep
// the explain surface in one file (the report shape is explain-specific and not
// shared with other tools). `selectorsSchema` is reused verbatim from extract so
// the two tools agree on the include/exclude contract.
const explainInputShape = {
  html: z
    .string()
    .describe(
      "Already-rendered HTML (post-JavaScript) to diagnose. Routed through the same normalize + Readability pipeline as `extract`, with Readability's real per-candidate scores surfaced. This is the ONLY input the server reads; it makes no outbound requests.",
    ),
  url: z
    .url()
    .describe(
      'Origin URL for absolutizing relative links during pagination/gating detection. NEVER fetched — origin context only.',
    )
    .optional(),
  selectors: selectorsSchema,
  topN: z
    .number()
    .int()
    .min(1)
    .max(20)
    .describe(
      'Maximum number of scored candidate nodes to return (highest first). Default 5.',
    )
    .default(5),
} as const;

const explainInputSchema = z.object(explainInputShape);

const candidateSchema = z
  .object({
    className: z
      .string()
      .describe(
        "The candidate's class attribute (raw, unsplit). Empty string when absent.",
      ),
    id: z.string().describe("The candidate's id attribute, or empty string."),
    score: z
      .number()
      .describe(
        "Readability's actual contentScore for this node (link-density-scaled). Higher is better; the top entry is Readability's raw top candidate before its parent-walking/only-child adjustments.",
      ),
    selector: z
      .string()
      .describe(
        "A CSS-ish hint (tag#id.class1.class2) for locating the node in the host DOM. NOT a unique locator — Readability's score lives on a JS expando invisible to CSS.",
      ),
    tag: z
      .string()
      .describe('Uppercase DOM tag name (e.g. "ARTICLE", "MAIN", "DIV").'),
    textLength: z
      .number()
      .int()
      .min(0)
      .describe(
        'Trimmed textContent length of the candidate node, for eyeballing content density.',
      ),
  })
  .describe(
    'One scored candidate node Readability considered, with its real contentScore.',
  );

const explainOutputShape = {
  schemaVersion: z
    .literal(1)
    .describe(
      'Structured-content schema version. Bumps only on breaking shape changes to this object.',
    ),
  content: z
    .string()
    .describe(
      'Readable rendering of the report (chosen root, ranked candidates, removal counts, gating/pagination, snapshot head) so content[0].text is always scannable.',
    ),
  chosenRoot: candidateSchema
    .nullable()
    .describe(
      'The highest-scoring candidate Readability computed — its raw top pick before parent-walking/only-child post-processing. Null when Readability scored nothing (e.g. empty input).',
    ),
  candidates: z
    .array(candidateSchema)
    .describe(
      "Scored candidate nodes (highest first), capped at topN. These are Readability's real contentScore values, not a self-computed heuristic.",
    ),
  readerable: z
    .boolean()
    .describe(
      'Readability isProbablyReaderable verdict on the normalized document.',
    ),
  parseSucceeded: z
    .boolean()
    .describe(
      'True when reader.parse() returned article content. False signals that `extract` would fall back to its selector cascade.',
    ),
  fallbackUsed: z
    .boolean()
    .describe(
      'Always false for explain — this tool runs only the Readability path it is diagnosing, never the fallback cascade.',
    ),
  gating: z
    .object({
      likely: z
        .boolean()
        .describe(
          'True when heuristics strongly suggest the content is paywalled or truncated.',
        ),
      reason: z
        .string()
        .describe(
          'Short label naming the detected signal (e.g. "paywall overlay").',
        ),
    })
    .nullable()
    .describe(
      'Likely paywall / gating signal detected before normalization. Null when none.',
    ),
  pagination: z
    .object({
      type: z
        .enum(['infinite', 'paginated'])
        .describe('Kind of pagination signal detected.'),
      nextUrl: z
        .string()
        .optional()
        .describe(
          'Absolute URL of the detected next page (paginated only). Never fetched.',
        ),
      selector: z
        .string()
        .optional()
        .describe(
          'CSS selector of the load-more / infinite-scroll sentinel (infinite only).',
        ),
    })
    .nullable()
    .describe('Detected pagination / infinite-scroll signal. Null when none.'),
  removedNodes: z
    .object({
      boilerplate: z
        .number()
        .int()
        .min(0)
        .describe(
          'Boilerplate blocks (related-posts, newsletter signup) stripped before Readability.',
        ),
      chrome: z
        .number()
        .int()
        .min(0)
        .describe(
          'Browser-chrome nodes stripped (scrollbars, consent banners, overlays).',
        ),
      total: z
        .number()
        .int()
        .min(0)
        .describe(
          'Net element count removed across the whole pipeline (delta vs. the parsed document).',
        ),
    })
    .describe(
      'Breakdown of nodes removed before Readability saw the document, reused from the extract diagnostics path.',
    ),
  snapshot: z
    .object({
      html: z
        .string()
        .describe(
          'The sanitized-by-normalization (post chrome/boilerplate/script strip) HTML fed to Readability — "what Readability saw". Not DOMPurify-sanitized (that runs on Readability\'s output in `extract`), so it may still carry inline event handlers (`onerror`/`onclick`/…); it is diagnostic data — do not render verbatim.',
        ),
      truncated: z
        .boolean()
        .describe(
          'True when the snapshot was cut at snapshotMaxChars (default 4000).',
        ),
    })
    .describe('Pre-Readability HTML snapshot of the normalized document body.'),
} as const;

const explainOutput = z.object(explainOutputShape);

function formatGating(report: ExplainReport): string {
  const g = report.gating;
  if (!g) {
    return 'none';
  }
  return `${g.reason}${g.likely ? '' : ' (weak)'}`;
}

function formatPagination(report: ExplainReport): string {
  const p = report.pagination;
  if (!p) {
    return 'none';
  }
  if (p.type === 'paginated') {
    return `paginated -> ${p.nextUrl ?? '(no href)'}`;
  }
  return `infinite (${p.selector ?? 'sentinel'})`;
}

function renderText(report: ExplainReport): string {
  const lines: string[] = [];
  const root = report.chosenRoot;
  lines.push(
    `readerable: ${report.readerable ? 'yes' : 'no'}  parse: ${report.parseSucceeded ? 'ok' : 'fail'}  fallback: ${report.fallbackUsed ? 'yes' : 'no'}`,
  );
  lines.push(
    `chosen root: ${root ? `${root.selector}  (score ${root.score.toFixed(2)}, ${root.textLength} chars)` : '(no candidate scored)'}`,
  );
  lines.push(`top candidates (${report.candidates.length}):`);
  if (report.candidates.length === 0) {
    lines.push('  (none)');
  }
  report.candidates.forEach((c, i) => {
    lines.push(
      `  ${i + 1}. ${c.selector}  score ${c.score.toFixed(2)}  (${c.textLength} chars)`,
    );
  });
  const r = report.removedNodes;
  lines.push(
    `removed: total=${r.total} (chrome=${r.chrome}, boilerplate=${r.boilerplate})`,
  );
  lines.push(`gating: ${formatGating(report)}`);
  lines.push(`pagination: ${formatPagination(report)}`);
  lines.push(
    `snapshot (${report.snapshot.html.length} chars${report.snapshot.truncated ? ', truncated' : ''}):`,
  );
  lines.push(report.snapshot.html);
  return lines.join('\n');
}

export function explain(rawArgs: unknown): CallToolResult {
  const args = explainInputSchema.parse(rawArgs);
  const report = buildExplainReport({
    html: args.html,
    selectors: args.selectors,
    topN: args.topN,
    url: args.url,
  });
  const content = renderText(report);
  return {
    content: [{ text: content, type: 'text' }],
    structuredContent: {
      schemaVersion: 1,
      content,
      chosenRoot: report.chosenRoot,
      candidates: report.candidates,
      readerable: report.readerable,
      parseSucceeded: report.parseSucceeded,
      fallbackUsed: report.fallbackUsed,
      gating: report.gating ?? null,
      pagination: report.pagination ?? null,
      removedNodes: report.removedNodes,
      snapshot: report.snapshot,
    },
  };
}

export const EXPLAIN_TOOL_DESCRIPTION = `Post-mortem diagnostics for extraction: shows WHY Readability picked what it picked. Returns the chosen root, the ranked candidate nodes with their REAL Readability contentScore values (read off the DOM expando Readability stamps during scoring), a categorized removed-nodes breakdown, gating/pagination signals, and a snapshot of the normalized HTML fed to Readability. Runs the same normalize + Readability pipeline as \`extract\` (no fallback cascade, no Turndown). The server fetches nothing: \`html\` is the only source, and \`url\` (optional) is origin context only.`;

export function explainHandler(args: unknown): CallToolResult {
  try {
    return explain(args);
  } catch (err) {
    logger.error(
      `explain failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return toErrorResult(err);
  }
}

export function registerExplainTool(server: McpServer): ToolHandle {
  return server.registerTool(
    'explain',
    {
      title: 'Explain why Readability picked what it picked',
      description: EXPLAIN_TOOL_DESCRIPTION,
      inputSchema: explainInputShape,
      outputSchema: explainOutput,
    },
    explainHandler,
  );
}
