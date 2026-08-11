import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { isMissingLlmProviderKeyMessage } from '../modules/projects/orchestrator-error.util';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const record = exceptionResponse as Record<string, unknown>;
        message =
          (typeof record.msg === 'string' && record.msg) ||
          (typeof record.message === 'string' && record.message) ||
          message;
        if (Array.isArray(record.message)) {
          message = record.message.map(String).join('; ');
        }
      }
    } else if (exception instanceof Error) {
      const errorName = exception.name;

      if (errorName === 'TokenExpiredError') {
        status = HttpStatus.UNAUTHORIZED;
        message = 'Token expired';
      } else if (errorName === 'JsonWebTokenError') {
        status = HttpStatus.UNAUTHORIZED;
        message = 'Invalid token';
      } else if (errorName === 'NotBeforeError') {
        status = HttpStatus.UNAUTHORIZED;
        message = 'Token not yet valid';
      } else {
        message = exception.message;
      }
    }

    let code = this.mapStatusToErrorCode(status);
    if (isMissingLlmProviderKeyMessage(message)) {
      code = 1340; // GenerationErrorCodes.LlmProviderKeyMissing
      if (status >= 500) {
        status = HttpStatus.BAD_REQUEST;
      }
    }

    response.status(status).json({
      code,
      msg: message,
      data: null,
    });
  }

  private mapStatusToErrorCode(status: number): number {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return 1001; // InvalidToken
      case HttpStatus.FORBIDDEN:
        return 1003; // Forbidden
      case HttpStatus.NOT_FOUND:
        return 1100; // ProjectNotFound
      case HttpStatus.BAD_REQUEST:
        return 1503; // ValidationError
      case HttpStatus.CONFLICT:
        return 1102; // ProjectAlreadyExists
      case HttpStatus.BAD_GATEWAY:
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 1502; // ServiceUnavailable
      default:
        return 1500; // InternalServerError
    }
  }
}
