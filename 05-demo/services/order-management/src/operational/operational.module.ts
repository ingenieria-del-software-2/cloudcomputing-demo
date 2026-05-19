import { Module } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { MetricsModule } from '../metrics/metrics.module';
import { OperationalController } from './operational.controller';
import { SQS_READINESS_PROBE, SqsReadinessProbe } from './readiness.probes';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [LoggingModule, MetricsModule],
  controllers: [OperationalController],
  providers: [
    ReadinessService,
    {
      provide: SQS_READINESS_PROBE,
      useClass: SqsReadinessProbe,
    },
  ],
})
export class OperationalModule {}
