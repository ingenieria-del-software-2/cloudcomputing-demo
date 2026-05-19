import { Module } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { MetricsModule } from '../metrics/metrics.module';
import { GenerateReceiptProcessor } from './application/generate-receipt.processor';
import {
  ProcessedReceiptStore,
  ReceiptEventSink,
  ReceiptProcessor,
} from './application/receipt.ports';
import { InMemoryProcessedReceiptStore } from './infrastructure/in-memory-processed-receipt.store';
import { ReceiptTelemetry } from './infrastructure/receipt-telemetry';
import { SqsReceiptConsumer } from './infrastructure/sqs-receipt.consumer';

@Module({
  imports: [LoggingModule, MetricsModule],
  providers: [
    SqsReceiptConsumer,
    {
      provide: ReceiptProcessor,
      useClass: GenerateReceiptProcessor,
    },
    {
      provide: ProcessedReceiptStore,
      useClass: InMemoryProcessedReceiptStore,
    },
    {
      provide: ReceiptEventSink,
      useClass: ReceiptTelemetry,
    },
  ],
})
export class ReceiptModule {}
