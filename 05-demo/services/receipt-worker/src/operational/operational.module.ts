import { Module } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { MetricsModule } from '../metrics/metrics.module';
import { OperationalController } from './operational.controller';
import { ReadinessService } from './readiness.service';
import { SqsReadinessProbe } from './sqs-readiness.probe';

@Module({
  imports: [LoggingModule, MetricsModule],
  controllers: [OperationalController],
  providers: [ReadinessService, SqsReadinessProbe],
})
export class OperationalModule {}
