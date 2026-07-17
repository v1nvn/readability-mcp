import type { ReadabilityOptions } from '../pipeline/readability.js';

export type ExtractionMode = 'aggressive' | 'balanced' | 'conservative';

export interface ResolveReadabilityInput {
  readonly extraction?: ExtractionMode;
  readonly keepClasses?: boolean;
  readonly maxNodes?: number;
  readonly minArticleLength?: number;
  readonly readabilityOverrides?: Readonly<Record<string, unknown>>;
}

// Readability.js confirmed defaults.
const DEFAULT_CHAR_THRESHOLD = 500;
const DEFAULT_N_TOP_CANDIDATES = 5;

// Readability keeps a class only by strict `classesToPreserve.includes(cls)`
// equality (not regex), stripping code-block language tokens by default; list
// the common highlight.js/prism `language-*` tokens so fences keep their tag.
// Applies only when `keepClasses` is false.
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
  'language-javascript',
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
  'language-typescript',
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
      return {
        charThreshold: Math.round(DEFAULT_CHAR_THRESHOLD / 2),
        nbTopCandidates: DEFAULT_N_TOP_CANDIDATES * 2,
      };
    case 'balanced':
      // null ⇒ emit nothing; Readability uses its own defaults.
      return null;
    case 'conservative':
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

  const charThreshold =
    input.minArticleLength !== undefined
      ? input.minArticleLength
      : modeKnobs?.charThreshold;
  const nbTopCandidates = modeKnobs?.nbTopCandidates;

  // Escape hatch spreads last so it wins verbatim over every derived knob.
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
