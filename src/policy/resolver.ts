// Semantic option → Readability knob translation (DESIGN §5.3).
//
// The public API exposes stable, intent-level options (extraction:
// balanced/aggressive/conservative, minArticleLength, maxNodes) and hides
// Readability's scorer-internal knobs. `balanced` deliberately emits NO
// charThreshold/nbTopCandidates so Readability falls back to its own defaults
// (500 / 5 — confirmed in Readability.js). Aggressive/conservative derive from
// those defaults. `readabilityOverrides` is the escape hatch: merged verbatim
// on top, documented as implementation-specific and unstable.

import type { ReadabilityOptions } from '../pipeline/readability.js';

export type ExtractionMode = 'aggressive' | 'balanced' | 'conservative';

export interface ResolveReadabilityInput {
  readonly extraction?: ExtractionMode;
  readonly keepClasses?: boolean;
  readonly maxNodes?: number;
  readonly minArticleLength?: number;
  readonly readabilityOverrides?: Readonly<Record<string, unknown>>;
}

// Readability.js confirmed defaults (DEFAULT_CHAR_THRESHOLD / DEFAULT_N_TOP_CANDIDATES).
const DEFAULT_CHAR_THRESHOLD = 500;
const DEFAULT_N_TOP_CANDIDATES = 5;

// Readability's `_cleanClasses` keeps a class only if `classesToPreserve.includes(cls)`
// — strict string equality, NOT regex. A fenced code block's language (e.g.
// `language-ts`) lives in the class attribute, and Readability strips classes by
// default, which is why fenced blocks otherwise render as bare ``` fences. We
// enumerate the common highlight.js / prism `language-*` tokens so documentation,
// GitHub, and Stack Overflow fixtures keep their language tag (e.g. ```ts).
// `hljs` is highlight.js's own marker class. When `keepClasses: true` is set the
// caller opts out of cleaning entirely, so this list only applies to the default.
const CLASSES_TO_PRESERVE: readonly string[] = [
  'hljs',
  'language-asm',
  'language-assembly',
  'language-bash',
  'language-c',
  'language-clojure',
  'language-cpp',
  'language-cs',
  'language-csharp',
  'language-css',
  'language-dart',
  'language-diff',
  'language-dockerfile',
  'language-elixir',
  'language-erlang',
  'language-go',
  'language-graphql',
  'language-haskell',
  'language-html',
  'language-ini',
  'language-java',
  'language-js',
  'language-jsx',
  'language-json',
  'language-kotlin',
  'language-lisp',
  'language-lua',
  'language-md',
  'language-markdown',
  'language-objc',
  'language-objectivec',
  'language-perl',
  'language-php',
  'language-plaintext',
  'language-powershell',
  'language-py',
  'language-python',
  'language-r',
  'language-rb',
  'language-rs',
  'language-ruby',
  'language-rust',
  'language-scala',
  'language-sh',
  'language-shell',
  'language-sql',
  'language-swift',
  'language-text',
  'language-toml',
  'language-ts',
  'language-tsx',
  'language-vim',
  'language-wasm',
  'language-xml',
  'language-yaml',
  'language-yml',
];

interface ModeKnobs {
  readonly charThreshold: number;
  readonly nbTopCandidates: number;
}

function knobsForMode(mode: ExtractionMode): ModeKnobs | null {
  switch (mode) {
    case 'aggressive':
      // Lower the bar for an article and widen the candidate pool.
      return {
        charThreshold: Math.round(DEFAULT_CHAR_THRESHOLD / 2),
        nbTopCandidates: DEFAULT_N_TOP_CANDIDATES * 2,
      };
    case 'balanced':
      // null ⇒ emit nothing; Readability uses its own defaults.
      return null;
    case 'conservative':
      // Raise the bar and narrow the pool so only high-confidence trees win.
      return {
        charThreshold: DEFAULT_CHAR_THRESHOLD * 2,
        nbTopCandidates: Math.max(1, Math.round(DEFAULT_N_TOP_CANDIDATES / 2)),
      };
  }
}

export function resolveReadabilityOptions(
  input: ResolveReadabilityInput,
): ReadabilityOptions {
  const mode = input.extraction ?? 'balanced';
  const modeKnobs = knobsForMode(mode);
  const keepClasses = input.keepClasses ?? false;

  // An explicit minArticleLength overrides whatever the mode derived.
  const charThreshold =
    input.minArticleLength !== undefined
      ? input.minArticleLength
      : modeKnobs?.charThreshold;
  const nbTopCandidates = modeKnobs?.nbTopCandidates;

  // Build once (no mutation of readonly fields). The escape hatch spreads last
  // so power users win verbatim over every derived knob.
  return {
    classesToPreserve: keepClasses ? [] : [...CLASSES_TO_PRESERVE],
    keepClasses,
    ...(charThreshold !== undefined ? { charThreshold } : {}),
    ...(nbTopCandidates !== undefined ? { nbTopCandidates } : {}),
    ...(input.maxNodes !== undefined
      ? { maxElemsToParse: input.maxNodes }
      : {}),
    ...(input.readabilityOverrides ?? {}),
  };
}
