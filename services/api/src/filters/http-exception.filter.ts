import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

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
        message = ((exceptionResponse as Record<string, unknown>).message as string) || message;
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

    const code = this.mapStatusToErrorCode(status);

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
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 1502; // ServiceUnavailable
      default:
        return 1500; // InternalServerError
    }
  }
}
