import type { ReceiptCommand } from '../domain/receipt-command';

export type ReceiptProcessStatus = 'success' | 'duplicate';

export interface ReceiptProcessResult {
  status: ReceiptProcessStatus;
  receiptId?: string;
}

export abstract class ProcessedReceiptStore {
  abstract has(operationId: string): boolean;
  abstract markProcessed(operationId: string, receiptId: string): void;
}

export abstract class ReceiptProcessor {
  abstract process(command: ReceiptCommand): Promise<ReceiptProcessResult>;
}

export type ReceiptEvent =
  | {
      type: 'receipt_command_received';
      requestId: string;
      operationId: string;
      commandId: string;
      producerVersion: string;
    }
  | {
      type: 'receipt_generated';
      requestId: string;
      operationId: string;
      commandId: string;
      receiptId: string;
      producerVersion: string;
    }
  | {
      type: 'receipt_duplicate_ignored';
      requestId: string;
      operationId: string;
      commandId: string;
      producerVersion: string;
    }
  | {
      type: 'receipt_invalid_discarded';
      reason: string;
    }
  | {
      type: 'receipt_failed';
      reason: string;
    }
  | {
      type: 'sqs_delete_failed';
      reason: string;
    };

export abstract class ReceiptEventSink {
  abstract publish(event: ReceiptEvent): void;
}
