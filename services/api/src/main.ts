import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { LoggerService } from './observability/logger.service';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { HttpExceptionFilter } from './filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Worker 回写 /api/documents/:id/index-result 时携带每块 embedding（如 1024 维），默认 ~100kb 易超限导致索引失败
  app.useBodyParser('json', { limit: '25mb' });
  app.enableCors();
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(3000);
  const logger = app.get(LoggerService);
  logger.info('API service running on http://localhost:3000', { port: 3000 });
}
bootstrap();
