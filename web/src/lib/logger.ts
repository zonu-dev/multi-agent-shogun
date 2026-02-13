type LogLevel = 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown> | undefined;

interface ClientLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

const CLIENT_LOG_SCOPE = 'client';

const toLogEntry = (level: LogLevel, message: string, context?: LogContext): ClientLogEntry => ({
  timestamp: new Date().toISOString(),
  level,
  message,
  ...(context === undefined ? {} : { context }),
});

const writeLog = (level: LogLevel, message: string, context?: LogContext): void => {
  const entry = toLogEntry(level, `[${CLIENT_LOG_SCOPE}] ${message}`, context);
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
