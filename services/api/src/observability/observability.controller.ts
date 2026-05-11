import { Controller, Get, Query } from '@nestjs/common';
import { LoggerService } from './logger.service';
import { MetricsService } from './metrics.service';

@Controller('api/observability')
export class ObservabilityController {
  constructor(
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService
  ) {}

  @Get('metrics')
  getMetrics() {
    return this.metrics.getSnapshot();
  }

  @Get('logs')
  getLogs(@Query('limit') limit?: number) {
    return { logs: this.logger.getRecentLogs(Number(limit) || 100) };
  }
}
