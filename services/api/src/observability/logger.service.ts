import { Injectable } from '@nestjs/common';

export interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  requestId?: string;
  traceId?: string;
  service: string;
  timestamp: string;
  durationMs?: number;
  error?: string;
  [key: string]: unknown;
}

const MAX_LOG_ENTRIES = 1000;
const recentLogs: LogEntry[] = [];

function createEntry(
  level: LogEntry['level'],
  message: string,
  meta?: Partial<LogEntry>
): LogEntry {
  return {
    level,
    message,
    service: 'api',
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

@Injectable()
export class LoggerService {
  info(message: string, meta?: Partial<LogEntry>) {
    write(createEntry('info', message, meta));
  }

  warn(message: string, meta?: Partial<LogEntry>) {
    write(createEntry('warn', message, meta));
  }

  error(message: string, meta?: Partial<LogEntry>) {
    write(createEntry('error', message, meta));
  }

  debug(message: string, meta?: Partial<LogEntry>) {
    write(createEntry('debug', message, meta));
  }

  getRecentLogs(limit = 100): LogEntry[] {
    return recentLogs.slice(-limit);
  }
}
