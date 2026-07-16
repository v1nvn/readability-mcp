import { levelEnabled, loadConfig, type LogLevel } from './config.js';

type Writer = (message: string) => void;

const LEVEL_LABEL: Record<Exclude<LogLevel, 'silent'>, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

function format(level: Exclude<LogLevel, 'silent'>, message: string): string {
  return `${LEVEL_LABEL[level]} ${message}`;
}

function emit(
  writer: Writer,
  level: Exclude<LogLevel, 'silent'>,
  message: string,
): void {
  writer(format(level, message));
}

class Logger {
  private readonly stderr: Writer;

  constructor(stderr: Writer = line => process.stderr.write(`${line}\n`)) {
    this.stderr = stderr;
  }

  debug(message: string): void {
    if (levelEnabled(activeConfig, 'debug')) {
      emit(this.stderr, 'debug', message);
    }
  }

  error(message: string): void {
    if (levelEnabled(activeConfig, 'error')) {
      emit(this.stderr, 'error', message);
    }
  }

  info(message: string): void {
    if (levelEnabled(activeConfig, 'info')) {
      emit(this.stderr, 'info', message);
    }
  }

  warn(message: string): void {
    if (levelEnabled(activeConfig, 'warn')) {
      emit(this.stderr, 'warn', message);
    }
  }
}

const activeConfig = loadConfig();

export const logger = new Logger();
