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

export interface MetricCounter {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export interface MetricHistogram {
  name: string;
  labels: Record<string, string>;
  count: number;
  sum: number;
  min: number;
  max: number;
}

export interface SpanEvent {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  operation: string;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  status: 'ok' | 'error';
  attributes: Record<string, unknown>;
  error?: string;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  histograms: Record<string, { count: number; sum: number; min: number; max: number }>;
  activeSpans: number;
  totalTraces: number;
  uptimeSeconds: number;
}
