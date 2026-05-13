import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();

    const exceptionResponse = exception.getResponse();
    let message = 'Internal server error';

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      message = ((exceptionResponse as Record<string, unknown>).message as string) || message;
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
