export type TransactionErrorCode =
  | 'INVALID_REQUEST'
  | 'IDEMPOTENCY_CONFLICT'
  | 'LEDGER_FAILED'
  | 'LEDGER_TIMEOUT'
  | 'RECEIPT_QUEUE_FAILED'
  | 'INJECTED_FAILURE';

export class TransactionError extends Error {
  constructor(
    readonly status: number,
    readonly code: TransactionErrorCode,
    message: string,
    readonly requestId?: string,
    readonly operationId?: string,
  ) {
    super(message);
  }
}

export function invalidIdempotencyKey(): TransactionError {
  return new TransactionError(
    400,
    'INVALID_REQUEST',
    'Idempotency-Key header is required',
  );
}
