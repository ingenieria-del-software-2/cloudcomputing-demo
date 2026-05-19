import { Module } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { MetricsModule } from '../metrics/metrics.module';
import { OperationalController } from './operational.controller';
import {
  DB_READINESS_PROBE,
  PostgresReadinessProbe,
  S3_READINESS_PROBE,
  S3ReadinessProbe,
  SQS_READINESS_PROBE,
  SqsReadinessProbe,
} from './readiness.probes';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [LoggingModule, MetricsModule],
  controllers: [OperationalController],
  providers: [
    ReadinessService,
    {
      provide: DB_READINESS_PROBE,
      useClass: PostgresReadinessProbe,
    },
    {
      provide: SQS_READINESS_PROBE,
      useClass: SqsReadinessProbe,
    },
    {
      provide: S3_READINESS_PROBE,
      useClass: S3ReadinessProbe,
    },
  ],
})
export class OperationalModule {}
