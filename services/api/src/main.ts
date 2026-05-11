import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { LoggerService } from './observability/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(3000);
  const logger = app.get(LoggerService);
  logger.info('API service running on http://localhost:3000', { port: 3000 });
}
bootstrap();
