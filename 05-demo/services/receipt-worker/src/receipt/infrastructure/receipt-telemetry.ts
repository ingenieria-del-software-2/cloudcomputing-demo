import { Injectable } from '@nestjs/common';
import { StructuredLoggerService } from '../../logging/structured-logger.service';
import { MetricsService } from '../../metrics/metrics.service';
import { ReceiptEvent, ReceiptEventSink } from '../application/receipt.ports';

@Injectable()
export class ReceiptTelemetry implements ReceiptEventSink {
  constructor(
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLoggerService,
  ) {}

  publish(event: ReceiptEvent): void {
    switch (event.type) {
      case 'receipt_command_received':
        this.metrics.recordSqsConsume('success', event.producerVersion);
        this.logger.info('receipt_command_received', {
          request_id: event.requestId,
          operation_id: event.operationId,
          command_id: event.commandId,
          producer_version: event.producerVersion,
        });
        break;
      case 'receipt_generated':
        this.metrics.recordReceiptProcessed('success', event.producerVersion);
        this.logger.info('receipt_generated', {
          request_id: event.requestId,
          operation_id: event.operationId,
          command_id: event.commandId,
          receipt_id: event.receiptId,
          producer_version: event.producerVersion,
        });
        break;
      case 'receipt_duplicate_ignored':
        this.metrics.recordReceiptProcessed('duplicate', event.producerVersion);
        this.logger.warn('receipt_duplicate_ignored', {
          request_id: event.requestId,
          operation_id: event.operationId,
          command_id: event.commandId,
          producer_version: event.producerVersion,
        });
        break;
      case 'receipt_invalid_discarded':
        this.metrics.recordSqsConsume('invalid');
        this.metrics.recordReceiptProcessed('invalid');
        this.logger.warn('receipt_invalid_discarded', {
          reason: event.reason,
        });
        break;
      case 'receipt_failed':
        this.metrics.recordSqsConsume('failure');
        this.metrics.recordReceiptProcessed('failure');
        this.logger.error('receipt_failed', {
          reason: event.reason,
        });
        break;
      case 'sqs_delete_failed':
        this.metrics.recordSqsDelete('failure');
        this.logger.error('sqs_delete_failed', {
          reason: event.reason,
        });
        break;
    }
  }
}
