import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';
import { metrics } from './metrics';
import { startSpan, endSpan } from './tracer';

export interface RequestWithObservability extends Request {
  requestId: string;
  traceId: string;
}

export function observabilityMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const traceId = (req.headers['x-trace-id'] as string) || requestId;

  const obsReq = req as RequestWithObservability;
  obsReq.requestId = requestId;
  obsReq.traceId = traceId;

  res.setHeader('X-Request-Id', requestId);
  if (!req.headers['x-trace-id']) {
    res.setHeader('X-Trace-Id', traceId);
  }

  metrics.increment('http_requests_total', { method: req.method, path: req.path });

  const spanId = startSpan(traceId, `${req.method} ${req.path}`, {
    httpMethod: req.method,
    httpPath: req.path,
    requestId,
  });

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;

    endSpan(spanId);
    metrics.increment('http_responses_total', {
      method: req.method,
      path: req.path,
      status: String(statusCode),
    });
    metrics.recordLatency('http_request_duration_ms', durationMs, {
      method: req.method,
      path: req.path,
    });

    const logMeta: Record<string, unknown> = {
      requestId,
      traceId,
      method: req.method,
      path: req.path,
      statusCode,
      durationMs,
      userAgent: req.headers['user-agent'] || '',
    };

    if (statusCode >= 500) {
      logger.error(`${req.method} ${req.path} ${statusCode}`, logMeta);
    } else if (statusCode >= 400) {
      logger.warn(`${req.method} ${req.path} ${statusCode}`, logMeta);
    } else {
      logger.info(`${req.method} ${req.path} ${statusCode}`, logMeta);
    }
  });

  next();
}

export function observabilityErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  void _next;
  const obsReq = req as RequestWithObservability;
  const requestId = obsReq.requestId || 'unknown';
  const traceId = obsReq.traceId || 'unknown';

  logger.error('Unhandled error', {
    requestId,
    traceId,
    error: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
  });

  metrics.increment('errors_total', { type: 'unhandled' });

  res.status(500).json({
    error: 'Internal server error',
    requestId,
  });
}
