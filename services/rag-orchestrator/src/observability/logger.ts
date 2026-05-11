import { LogEntry } from './types';

const MAX_LOG_ENTRIES = 1000;
const recentLogs: LogEntry[] = [];

const SERVICE_NAME = 'rag-orchestrator';

function createEntry(
  level: LogEntry['level'],
  message: string,
  meta?: Partial<LogEntry>
): LogEntry {
  return {
    level,
    message,
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    ...meta,
  };
}

function write(entry: LogEntry): void {
  const json = JSON.stringify(entry);
  switch (entry.level) {
    case 'error':
      console.error(json);
      break;
    case 'warn':
      console.warn(json);
      break;
    default:
      console.log(json);
  }

  recentLogs.push(entry);
  if (recentLogs.length > MAX_LOG_ENTRIES) {
    recentLogs.shift();
  }
}

export const logger = {
  info(message: string, meta?: Partial<LogEntry>) {
    write(createEntry('info', message, meta));
  },

  warn(message: string, meta?: Partial<LogEntry>) {
    write(createEntry('warn', message, meta));
  },

  error(message: string, meta?: Partial<LogEntry>) {
    write(createEntry('error', message, meta));
  },

  debug(message: string, meta?: Partial<LogEntry>) {
    write(createEntry('debug', message, meta));
  },

  getRecentLogs(limit = 100): LogEntry[] {
    return recentLogs.slice(-limit);
  },

  clearLogs(): void {
    recentLogs.length = 0;
  },
};
