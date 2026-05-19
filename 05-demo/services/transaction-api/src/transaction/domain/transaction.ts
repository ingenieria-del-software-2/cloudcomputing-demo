import { createHash, randomUUID } from 'node:crypto';
import type { ReceiptCommand } from '../application/transaction.ports';

export interface CreateTransactionInput {
  amount: number;
  currency: string;
  description: string;
}

export interface TransactionAcceptedResponse {
  operation_id: string;
  transaction_id: string;
  ledger_entry_id: string;
  receipt_status: 'queued';
  version: string;
}

export interface IdempotencyRecord {
  fingerprint: string;
  operationId: string;
  transactionId: string;
  commandId: string;
  ledgerEntryId?: string;
  receiptCommand?: ReceiptCommand;
  acceptedResponse?: TransactionAcceptedResponse;
}

export function newTransactionRecord(
  body: CreateTransactionInput,
): IdempotencyRecord {
  return {
    fingerprint: transactionFingerprint(body),
    operationId: newId('op'),
    transactionId: newId('tx'),
    commandId: newId('cmd'),
  };
}

export function transactionFingerprint(body: CreateTransactionInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        amount: body.amount,
        currency: body.currency,
        description: body.description,
      }),
    )
    .digest('hex');
}

export function idempotencyKeyHash(idempotencyKey: string): string {
  return `sha256:${createHash('sha256').update(idempotencyKey).digest('hex')}`;
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
