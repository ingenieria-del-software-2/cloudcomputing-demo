import type {
  IdempotencyRecord,
  TransactionAcceptedResponse,
} from '../domain/transaction';

export interface LedgerEntryRequest {
  operationId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  requestId: string;
}

export interface LedgerEntryResponse {
  ledgerEntryId: string;
  status: 'created' | 'replayed';
}

export class LedgerPortError extends Error {
  constructor(readonly kind: 'failed' | 'timeout') {
    super(`ledger-service ${kind}`);
  }
}

export abstract class LedgerPort {
  abstract createEntry(
    request: LedgerEntryRequest,
  ): Promise<LedgerEntryResponse>;
}

export interface ReceiptCommand {
  type: 'GenerateReceiptCommand';
  schema_version: '1';
  command_id: string;
  operation_id: string;
  transaction_id: string;
  ledger_entry_id: string;
  amount: number;
  currency: string;
  request_id: string;
  idempotency_key_hash: string;
  producer_service: 'transaction-api';
  producer_version: string;
  created_at: string;
}

export abstract class ReceiptPublisherPort {
  abstract publish(command: ReceiptCommand): Promise<void>;
}

export abstract class IdempotencyStore {
  abstract get(idempotencyKey: string): IdempotencyRecord | undefined;
  abstract set(idempotencyKey: string, record: IdempotencyRecord): void;
}

export type TransactionEvent =
  | {
      type: 'transaction_received';
      requestId: string;
      operationId: string;
      transactionId: string;
      idempotencyKeyHash: string;
    }
  | {
      type: 'idempotency_replay';
      requestId: string;
      response: TransactionAcceptedResponse;
    }
  | {
      type: 'ledger_attempt';
      version: string;
    }
  | {
      type: 'ledger_created';
      requestId: string;
      operationId: string;
      ledgerEntryId: string;
      durationMs: number;
      version: string;
    }
  | {
      type: 'ledger_failed';
      requestId: string;
      operationId: string;
      status: 502 | 504;
      errorType: 'ledger_failed' | 'ledger_timeout';
      version: string;
    }
  | {
      type: 'receipt_command_published';
      requestId: string;
      operationId: string;
      transactionId: string;
      commandId: string;
      version: string;
    }
  | {
      type: 'receipt_queue_failed';
      requestId: string;
      operationId: string;
      version: string;
    }
  | {
      type: 'transaction_accepted';
      version: string;
    }
  | {
      type: 'injected_failure';
      requestId: string;
      version: string;
    };

export abstract class TransactionEventSink {
  abstract publish(event: TransactionEvent): void;
}
