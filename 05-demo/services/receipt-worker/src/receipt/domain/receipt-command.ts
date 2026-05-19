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

export class InvalidReceiptCommandError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function parseReceiptCommand(body: string | undefined): ReceiptCommand {
  if (!body) {
    throw new InvalidReceiptCommandError('message body is required');
  }

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new InvalidReceiptCommandError('message body must be valid JSON');
  }

  if (!isRecord(value)) {
    throw new InvalidReceiptCommandError('message body must be an object');
  }

  const command = value;
  const commandID = requireString(command, 'command_id');
  const operationID = requireString(command, 'operation_id');
  const transactionID = requireString(command, 'transaction_id');
  const ledgerEntryID = requireString(command, 'ledger_entry_id');
  const currency = requireString(command, 'currency');
  const requestID = requireString(command, 'request_id');
  const idempotencyKeyHash = requireString(command, 'idempotency_key_hash');
  const producerVersion = requireString(command, 'producer_version');
  const createdAt = requireString(command, 'created_at');

  if (command.type !== 'GenerateReceiptCommand') {
    throw new InvalidReceiptCommandError('type must be GenerateReceiptCommand');
  }
  if (command.schema_version !== '1') {
    throw new InvalidReceiptCommandError('schema_version must be 1');
  }
  if (command.producer_service !== 'transaction-api') {
    throw new InvalidReceiptCommandError(
      'producer_service must be transaction-api',
    );
  }
  if (typeof command.amount !== 'number' || command.amount <= 0) {
    throw new InvalidReceiptCommandError('amount must be a positive number');
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new InvalidReceiptCommandError(
      'currency must be a 3-letter uppercase code',
    );
  }
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new InvalidReceiptCommandError('created_at must be an ISO date-time');
  }

  return {
    type: 'GenerateReceiptCommand',
    schema_version: '1',
    command_id: commandID,
    operation_id: operationID,
    transaction_id: transactionID,
    ledger_entry_id: ledgerEntryID,
    amount: command.amount,
    currency,
    request_id: requestID,
    idempotency_key_hash: idempotencyKeyHash,
    producer_service: 'transaction-api',
    producer_version: producerVersion,
    created_at: createdAt,
  };
}

function requireString(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== 'string' || value[key].trim() === '') {
    throw new InvalidReceiptCommandError(`${key} must be a non-empty string`);
  }

  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
