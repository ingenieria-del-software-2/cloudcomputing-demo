import { Module } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { MetricsModule } from '../metrics/metrics.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

@Module({
  imports: [LoggingModule, MetricsModule],
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}
