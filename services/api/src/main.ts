import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { LoggerService } from './observability/logger.service';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { HttpExceptionFilter } from './filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(3000);
  const logger = app.get(LoggerService);
  logger.info('API service running on http://localhost:3000', { port: 3000 });
}
bootstrap();
