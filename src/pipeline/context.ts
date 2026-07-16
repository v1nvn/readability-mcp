// Immutable extraction context threaded through the pipeline (DESIGN §6.1).
// Each stage receives the prior context and returns a NEW object with new
// fields merged via spread; existing fields are never mutated. The single
// unavoidable in-place mutation is Readability's, and it runs on a clone the
// readability stage owns (see readability.ts).

import type { ReadabilityParseResult } from './readability.js';

export interface Metadata {
  readonly byline?: string;
  readonly excerpt?: string;
  readonly lang?: string;
  readonly publishedTime?: string;
  readonly readingTimeMin?: number;
  readonly siteName?: string;
  readonly title?: string;
  readonly url?: string;
  readonly wordCount?: number;
}

export interface SanitizationDiagnostics {
  readonly iframes: number;
  readonly scripts: number;
}

export interface Diagnostics {
  readonly extractedNode?: string;
  readonly fallbackUsed: boolean;
  readonly readerable?: boolean;
  readonly removedNodes?: number;
  readonly sanitization?: SanitizationDiagnostics;
  readonly truncated: boolean;
}

export interface ExtractionContext {
  // Article HTML chosen by the extraction stage (post-Readability or fallback).
  readonly article?: null | Readonly<ReadabilityParseResult>;
  readonly diagnostics?: Diagnostics;
  // The cleaned, normalized jsdom Document (Readability parses a private clone).
  readonly document?: Document;
  // Element-count of the document before extraction, for the removedNodes delta.
  readonly documentElementCount?: number;
  readonly html: string;
  readonly markdown?: string;
  readonly metadata?: Metadata;
  readonly readerable?: boolean;
  // Selector naming the root that fed Turndown (surfaces as diagnostics.extractedNode).
  readonly rootSelector?: string;
  readonly sanitizedHtml?: string;
  readonly url?: string;
  // jsdom window kept for DOMPurify (it must run against the same window the doc came from).
  readonly window?: Window;
}
