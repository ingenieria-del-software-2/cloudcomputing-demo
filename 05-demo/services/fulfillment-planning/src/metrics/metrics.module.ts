import { APP_INTERCEPTOR } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsService } from './metrics.service';

@Module({
  providers: [
    MetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
