import { isPlaceholderSrc } from '../pipeline/normalize.js';
import { absolutize } from '../pipeline/urls.js';

export interface ImageEntry {
  readonly alt: string;
  readonly caption: string;
  readonly height?: number;
  readonly src: string;
  readonly width?: number;
}

function positiveInt(value: null | string): number | undefined {
  if (value === null) {
    return undefined;
  }
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// resolveLazyImages has already mutated placeholder srcs to real ones in the
// article HTML by the time this runs — reading `src` here gets the resolved
// value, so this walker does NOT re-run source resolution. isPlaceholderSrc
// skips any remaining data:/placeholder srcs the lazy resolver left alone.
export function collectImageInventory(
  html: string,
  window: Window,
  baseUrl?: string,
): ImageEntry[] {
  if (!html) {
    return [];
  }
  const probe = window.document.createElement('div');
  probe.innerHTML = html;

  const entries: ImageEntry[] = [];
  for (const img of probe.querySelectorAll('img')) {
    const rawSrc = img.getAttribute('src') ?? '';
    if (isPlaceholderSrc(rawSrc)) {
      continue;
    }
    const src = absolutize(rawSrc, baseUrl);
    if (!src) {
      continue;
    }
    const alt = img.getAttribute('alt') ?? '';
    const width = positiveInt(img.getAttribute('width'));
    const height = positiveInt(img.getAttribute('height'));
    // <figcaption> may precede OR follow the <img> inside the <figure>, so
    // closest('figure') + querySelector('figcaption') covers both orderings.
    const figure = img.closest('figure');
    const figcaption = figure?.querySelector('figcaption');
    const caption = figcaption
      ? figcaption.textContent.replace(/\s+/g, ' ').trim()
      : alt;
    entries.push({
      src,
      alt,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      caption,
    });
  }
  return entries;
}
