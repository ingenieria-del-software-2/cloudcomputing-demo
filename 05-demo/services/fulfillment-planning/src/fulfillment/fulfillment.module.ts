import { Module } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { MetricsModule } from '../metrics/metrics.module';
import { FulfillmentController } from './fulfillment.controller';
import { FulfillmentService } from './fulfillment.service';

@Module({
  imports: [LoggingModule, MetricsModule],
  controllers: [FulfillmentController],
  providers: [FulfillmentService],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
