import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LoggerService } from './logger.service';
import { MetricsService } from './metrics.service';

@Injectable()
export class ObservabilityInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const startTime = Date.now();
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const traceId = (request.headers['x-trace-id'] as string) || requestId;

    request.requestId = requestId;
    request.traceId = traceId;

    response.setHeader('X-Request-Id', requestId);

    const { method, path } = request;
    this.metrics.increment('http_requests_total', { method, path });

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - startTime;
          const statusCode = response.statusCode;

          this.metrics.increment('http_responses_total', {
            method,
            path,
            status: String(statusCode),
          });
          this.metrics.observe('http_request_duration_ms', durationMs, { method, path });

          this.logger.info(`${method} ${path} ${statusCode}`, {
            requestId,
            traceId,
            method,
            path,
            statusCode,
            durationMs,
          });
        },
        error: (err: Error) => {
          const durationMs = Date.now() - startTime;

          this.metrics.increment('http_responses_total', {
            method,
            path,
            status: '500',
          });
          this.metrics.increment('errors_total', { type: 'unhandled' });

          this.logger.error(`${method} ${path} 500`, {
            requestId,
            traceId,
            method,
            path,
            statusCode: 500,
            durationMs,
            error: err.message,
          });
        },
      })
    );
  }
}
