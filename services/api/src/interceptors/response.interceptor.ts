import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const response = httpContext.getResponse<Record<string, unknown>>();

    if (this.shouldSkip(response)) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        code: 0,
        msg: 'success',
        data: data ?? null,
      }))
    );
  }

  private shouldSkip(response: Record<string, unknown>): boolean {
    const contentType =
      typeof response.getHeader === 'function'
        ? response.getHeader('Content-Type')
        : response.contentType;

    if (typeof contentType === 'string') {
      if (contentType.includes('text/event-stream')) {
        return true;
      }
      if (contentType.includes('application/octet-stream')) {
        return true;
      }
    }

    return false;
  }
}
