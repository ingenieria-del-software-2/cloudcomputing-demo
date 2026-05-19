import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggingModule } from './logging/logging.module';
import { FaultInjectionModule } from './common/fault-injection/fault-injection.module';
import { MetricsModule } from './metrics/metrics.module';
import { OperationalModule } from './operational/operational.module';
import { TransactionModule } from './transaction/transaction.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MetricsModule,
    FaultInjectionModule,
    LoggingModule,
    OperationalModule,
    TransactionModule,
  ],
})
export class AppModule {}
