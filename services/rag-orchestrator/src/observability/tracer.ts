import { SpanEvent } from './types';

const MAX_SPANS = 5000;
const spans: SpanEvent[] = [];
const activeSpans = new Map<string, SpanEvent>();

export function startSpan(
  traceId: string,
  operation: string,
  attributes: Record<string, unknown> = {},
  parentSpanId?: string
): string {
  const spanId = `${traceId}-${spans.length + 1}`;
  const span: SpanEvent = {
    spanId,
    traceId,
    parentSpanId,
    operation,
    startTime: new Date().toISOString(),
    status: 'ok',
    attributes,
  };
  activeSpans.set(spanId, span);
  return spanId;
}

export function endSpan(spanId: string, error?: string): void {
  const span = activeSpans.get(spanId);
  if (!span) return;

  span.endTime = new Date().toISOString();
  span.durationMs = new Date(span.endTime).getTime() - new Date(span.startTime).getTime();
  if (error) {
    span.status = 'error';
    span.error = error;
  }

  activeSpans.delete(spanId);
  spans.push(span);

  if (spans.length > MAX_SPANS) {
    spans.splice(0, spans.length - MAX_SPANS);
  }
}

export function getSpansByTrace(traceId: string): SpanEvent[] {
  return spans.filter((s) => s.traceId === traceId);
}

export function getActiveSpanCount(): number {
  return activeSpans.size;
}

export function getRecentSpans(limit = 100): SpanEvent[] {
  return spans.slice(-limit);
}
