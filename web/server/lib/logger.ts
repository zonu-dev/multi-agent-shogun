type LogLevel = 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown> | undefined;

interface ServerLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

const SERVER_LOG_SCOPE = 'server';

const toLogEntry = (level: LogLevel, message: string, context?: LogContext): ServerLogEntry => ({
  timestamp: new Date().toISOString(),
  level,
  message: `[${SERVER_LOG_SCOPE}] ${message}`,
  ...(context === undefined ? {} : { context }),
});

const writeLog = (level: LogLevel, message: string, context?: LogContext): void => {
  const entry = toLogEntry(level, message, context);
  if (level === 'error') {
    console.error(entry);
    return;
  }

  if (level === 'warn') {
    console.warn(entry);
    return;
  }

  console.info(entry);
};

export const logger = {
  info: (message: string, context?: LogContext): void => {
    writeLog('info', message, context);
  },
  warn: (message: string, context?: LogContext): void => {
    writeLog('warn', message, context);
  },
  error: (message: string, context?: LogContext): void => {
    writeLog('error', message, context);
  },
};
