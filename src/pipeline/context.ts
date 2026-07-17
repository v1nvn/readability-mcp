import type { GatingSignal } from '../policy/gating.js';
import type { PaginationSignal } from '../policy/pagination.js';
import type { ReadabilityParseResult } from './readability.js';

export interface StructuredData {
  readonly '@type'?: string;
  readonly [key: string]: unknown;
}

export interface Metadata {
  readonly byline?: string;
  readonly canonical?: string;
  readonly estimator?: string;
  readonly excerpt?: string;
  readonly lang?: string;
  readonly publishedTime?: string;
  readonly readingTimeMin?: number;
  readonly siteName?: string;
  readonly structured?: StructuredData;
  readonly title?: string;
  readonly tokenEstimate?: number;
  readonly url?: string;
  readonly wordCount?: number;
}

export interface SanitizationDiagnostics {
  readonly iframes: number;
  readonly scripts: number;
}

export interface Diagnostics {
  readonly chromeRemoved?: number;
  readonly extractedNode?: string;
  readonly fallbackUsed: boolean;
  readonly gated?: GatingSignal;
  readonly imagesResolved?: number;
  readonly pagination?: PaginationSignal;
  readonly readerable?: boolean;
  readonly removedNodes?: number;
  readonly sanitization?: SanitizationDiagnostics;
  readonly truncated: boolean;
}

export interface ExtractionContext {
  readonly article?: null | Readonly<ReadabilityParseResult>;
  readonly diagnostics?: Diagnostics;
  readonly document?: Document;
  readonly documentElementCount?: number;
  readonly html: string;
  readonly markdown?: string;
  readonly metadata?: Metadata;
  readonly readerable?: boolean;
  readonly rootSelector?: string;
  readonly sanitizedHtml?: string;
  readonly url?: string;
  // Must be the same window the document came from — DOMPurify is bound to it.
  readonly window?: Window;
}
