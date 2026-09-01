import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FaultInjectionModule } from './common/fault-injection/fault-injection.module';
import { LoggingModule } from './logging/logging.module';
import { MetricsModule } from './metrics/metrics.module';
import { OperationalModule } from './operational/operational.module';
import { TrackingModule } from './tracking/tracking.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MetricsModule,
    FaultInjectionModule,
    LoggingModule,
    OperationalModule,
    TrackingModule,
  ],
})
export class AppModule {}
