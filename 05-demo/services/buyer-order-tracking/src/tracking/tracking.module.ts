import { Module } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { MetricsModule } from '../metrics/metrics.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  imports: [LoggingModule, MetricsModule],
  controllers: [TrackingController],
  providers: [TrackingService],
})
export class TrackingModule {}
