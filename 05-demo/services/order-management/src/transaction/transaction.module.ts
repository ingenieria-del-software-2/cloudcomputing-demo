import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggingModule } from '../logging/logging.module';
import { MetricsModule } from '../metrics/metrics.module';
import { CreateTransactionUseCase } from './application/create-transaction.use-case';
import {
  IdempotencyStore,
  LedgerPort,
  ReceiptPublisherPort,
  TransactionEventSink,
} from './application/transaction.ports';
import { HttpLedgerClient } from './infrastructure/http-ledger.client';
import { InMemoryIdempotencyStore } from './infrastructure/in-memory-idempotency.store';
import { SqsReceiptQueuePublisher } from './infrastructure/sqs-receipt-queue.publisher';
import { TransactionTelemetry } from './infrastructure/transaction-telemetry';
import { TransactionOutcomeFilter } from './infrastructure/transaction-outcome.filter';
import { TransactionController } from './transaction.controller';

@Module({
  imports: [LoggingModule, MetricsModule],
  controllers: [TransactionController],
  providers: [
    {
      provide: CreateTransactionUseCase,
      useFactory: (
        ledger: LedgerPort,
        receiptPublisher: ReceiptPublisherPort,
        idempotencyStore: IdempotencyStore,
        events: TransactionEventSink,
      ) =>
        new CreateTransactionUseCase({
          ledger,
          receiptPublisher,
          idempotencyStore,
          events,
        }),
      inject: [
        LedgerPort,
        ReceiptPublisherPort,
        IdempotencyStore,
        TransactionEventSink,
      ],
    },
    {
      provide: LedgerPort,
      useClass: HttpLedgerClient,
    },
    {
      provide: ReceiptPublisherPort,
      useClass: SqsReceiptQueuePublisher,
    },
    {
      provide: IdempotencyStore,
      useClass: InMemoryIdempotencyStore,
    },
    {
      provide: TransactionEventSink,
      useClass: TransactionTelemetry,
    },
    {
      provide: APP_FILTER,
      useClass: TransactionOutcomeFilter,
    },
  ],
})
export class TransactionModule {}
