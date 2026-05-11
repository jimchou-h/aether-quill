import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerService } from './logger.service';
import { MetricsService } from './metrics.service';
import { ObservabilityInterceptor } from './observability.interceptor';
import { ObservabilityController } from './observability.controller';

@Global()
@Module({
  controllers: [ObservabilityController],
  providers: [
    LoggerService,
    MetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ObservabilityInterceptor,
    },
  ],
  exports: [LoggerService, MetricsService],
})
export class ObservabilityModule {}
