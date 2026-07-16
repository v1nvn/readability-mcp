export interface ServerConfig {
  readonly logLevel: LogLevel;
  readonly name: 'readability-mcp';
  readonly version: string;
}

export type LogLevel = 'debug' | 'error' | 'info' | 'silent' | 'warn';

const VALID_LEVELS: readonly LogLevel[] = [
  'debug',
  'info',
  'warn',
  'error',
  'silent',
];

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.MAX_SAFE_INTEGER,
};

const DEFAULT_LOG_LEVEL: LogLevel = 'info';

function resolveLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = env.READABILITY_MCP_LOG_LEVEL;
  if (raw && (VALID_LEVELS as readonly string[]).includes(raw)) {
    return raw as LogLevel;
  }
  return DEFAULT_LOG_LEVEL;
}

// Tracks package.json `version` — bump both together at release.
const SERVER_VERSION = '0.1.0';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    name: 'readability-mcp',
    version: SERVER_VERSION,
    logLevel: resolveLogLevel(env),
  };
}

export function levelEnabled(
  config: ServerConfig,
  level: Exclude<LogLevel, 'silent'>,
): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[config.logLevel];
}
