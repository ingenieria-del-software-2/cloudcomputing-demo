import { Injectable } from '@nestjs/common';
import { StructuredLoggerService } from '../../logging/structured-logger.service';
import { MetricsService } from '../../metrics/metrics.service';
import {
  TransactionEvent,
  TransactionEventSink,
} from '../application/transaction.ports';

@Injectable()
export class TransactionTelemetry implements TransactionEventSink {
  constructor(
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLoggerService,
  ) {}

  publish(event: TransactionEvent): void {
    switch (event.type) {
      case 'transaction_received':
        this.logger.info('transaction_received', {
          request_id: event.requestId,
          operation_id: event.operationId,
          transaction_id: event.transactionId,
          idempotency_key_hash: event.idempotencyKeyHash,
        });
        break;
      case 'idempotency_replay':
        this.metrics.recordTransaction('replayed', event.response.version);
        this.logger.info('idempotency_replay', {
          request_id: event.requestId,
          operation_id: event.response.operation_id,
          transaction_id: event.response.transaction_id,
          ledger_entry_id: event.response.ledger_entry_id,
        });
        break;
      case 'ledger_attempt':
        this.metrics.recordLedgerRequest('attempt', event.version);
        break;
      case 'ledger_created':
        this.metrics.recordLedgerRequest('success', event.version);
        this.logger.info('ledger_created', {
          request_id: event.requestId,
          operation_id: event.operationId,
          ledger_entry_id: event.ledgerEntryId,
          duration_ms: event.durationMs,
        });
        break;
      case 'ledger_failed':
        this.metrics.recordLedgerRequest('failure', event.version);
        this.metrics.recordTransaction('ledger_failed', event.version);
        this.logger.error('transaction_failed', {
          request_id: event.requestId,
          operation_id: event.operationId,
          error_type: event.errorType,
          status: event.status,
        });
        break;
      case 'receipt_command_published':
        this.metrics.recordSqsPublish('success', event.version);
        this.logger.info('receipt_command_published', {
          request_id: event.requestId,
          operation_id: event.operationId,
          transaction_id: event.transactionId,
          command_id: event.commandId,
          queue: 'receipt-commands',
          producer_version: event.version,
        });
        break;
      case 'receipt_queue_failed':
        this.metrics.recordSqsPublish('failure', event.version);
        this.metrics.recordTransaction('queue_failed', event.version);
        this.logger.error('transaction_failed', {
          request_id: event.requestId,
          operation_id: event.operationId,
          error_type: 'receipt_queue_failed',
          status: 503,
        });
        break;
      case 'transaction_accepted':
        this.metrics.recordTransaction('accepted', event.version);
        break;
      case 'injected_failure':
        this.metrics.recordTransaction('injected_failure', event.version);
        this.logger.error('transaction_failed', {
          request_id: event.requestId,
          error_type: 'injected_failure',
          status: 500,
        });
        break;
    }
  }
}
