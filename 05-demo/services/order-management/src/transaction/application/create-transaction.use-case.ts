import {
  idempotencyKeyHash,
  newTransactionRecord,
  transactionFingerprint,
} from '../domain/transaction';
import type {
  CreateTransactionInput,
  IdempotencyRecord,
  TransactionAcceptedResponse,
} from '../domain/transaction';
import { invalidIdempotencyKey, TransactionError } from './transaction.errors';
import {
  IdempotencyStore,
  LedgerPort,
  LedgerPortError,
  ReceiptCommand,
  ReceiptPublisherPort,
  TransactionEventSink,
} from './transaction.ports';

export interface CreateTransactionCommand {
  body: CreateTransactionInput;
  idempotencyKey: string | undefined;
  requestId: string;
  version: string;
}

export interface CreateTransactionUseCaseDeps {
  ledger: LedgerPort;
  receiptPublisher: ReceiptPublisherPort;
  idempotencyStore: IdempotencyStore;
  events: TransactionEventSink;
}

export class CreateTransactionUseCase {
  constructor(private readonly deps: CreateTransactionUseCaseDeps) {}

  async execute(
    command: CreateTransactionCommand,
  ): Promise<TransactionAcceptedResponse> {
    const idempotencyKey = this.validIdempotencyKey(command.idempotencyKey);
    const fingerprint = transactionFingerprint(command.body);
    let record = this.deps.idempotencyStore.get(idempotencyKey);

    if (record) {
      if (record.fingerprint !== fingerprint) {
        throw new TransactionError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Idempotency-Key already used with a different payload',
          command.requestId,
          record.operationId,
        );
      }

      if (record.acceptedResponse) {
        this.deps.events.publish({
          type: 'idempotency_replay',
          requestId: command.requestId,
          response: record.acceptedResponse,
        });
        return record.acceptedResponse;
      }
    } else {
      record = newTransactionRecord(command.body);
      this.deps.idempotencyStore.set(idempotencyKey, record);
      this.deps.events.publish({
        type: 'transaction_received',
        requestId: command.requestId,
        operationId: record.operationId,
        transactionId: record.transactionId,
        idempotencyKeyHash: idempotencyKeyHash(idempotencyKey),
      });
    }

    if (!record.ledgerEntryId) {
      await this.createLedgerEntry(command, idempotencyKey, record);
    }

    const ledgerEntryId = record.ledgerEntryId;
    if (!ledgerEntryId) {
      throw new Error('Ledger entry must exist before accepting transaction');
    }

    await this.publishReceiptCommand(command, idempotencyKey, record);

    const response: TransactionAcceptedResponse = {
      operation_id: record.operationId,
      transaction_id: record.transactionId,
      ledger_entry_id: ledgerEntryId,
      receipt_status: 'queued',
      version: command.version,
    };

    record.acceptedResponse = response;
    this.deps.events.publish({
      type: 'transaction_accepted',
      version: command.version,
    });

    return response;
  }

  private async createLedgerEntry(
    command: CreateTransactionCommand,
    idempotencyKey: string,
    record: IdempotencyRecord,
  ): Promise<void> {
    try {
      const ledgerStartedAt = performance.now();
      this.deps.events.publish({
        type: 'ledger_attempt',
        version: command.version,
      });
      const ledgerResponse = await this.deps.ledger.createEntry({
        operationId: record.operationId,
        amount: command.body.amount,
        currency: command.body.currency,
        idempotencyKey,
        requestId: command.requestId,
      });
      record.ledgerEntryId = ledgerResponse.ledgerEntryId;
      this.deps.events.publish({
        type: 'ledger_created',
        requestId: command.requestId,
        operationId: record.operationId,
        ledgerEntryId: record.ledgerEntryId,
        durationMs: Math.round(performance.now() - ledgerStartedAt),
        version: command.version,
      });
    } catch (error) {
      if (error instanceof LedgerPortError && error.kind === 'timeout') {
        this.deps.events.publish({
          type: 'ledger_failed',
          requestId: command.requestId,
          operationId: record.operationId,
          status: 504,
          errorType: 'ledger_timeout',
          version: command.version,
        });
        throw new TransactionError(
          504,
          'LEDGER_TIMEOUT',
          'ledger-service timed out',
          command.requestId,
          record.operationId,
        );
      }

      this.deps.events.publish({
        type: 'ledger_failed',
        requestId: command.requestId,
        operationId: record.operationId,
        status: 502,
        errorType: 'ledger_failed',
        version: command.version,
      });
      throw new TransactionError(
        502,
        'LEDGER_FAILED',
        'ledger-service returned an error',
        command.requestId,
        record.operationId,
      );
    }
  }

  private async publishReceiptCommand(
    command: CreateTransactionCommand,
    idempotencyKey: string,
    record: IdempotencyRecord,
  ): Promise<void> {
    try {
      const receiptCommand = this.receiptCommand(
        command,
        idempotencyKey,
        record,
      );
      await this.deps.receiptPublisher.publish(receiptCommand);
      this.deps.events.publish({
        type: 'receipt_command_published',
        requestId: command.requestId,
        operationId: record.operationId,
        transactionId: record.transactionId,
        commandId: record.commandId,
        version: command.version,
      });
    } catch {
      this.deps.events.publish({
        type: 'receipt_queue_failed',
        requestId: command.requestId,
        operationId: record.operationId,
        version: command.version,
      });
      throw new TransactionError(
        503,
        'RECEIPT_QUEUE_FAILED',
        'Transaction could not be accepted because receipt command was not queued',
        command.requestId,
        record.operationId,
      );
    }
  }

  private receiptCommand(
    command: CreateTransactionCommand,
    idempotencyKey: string,
    record: IdempotencyRecord,
  ): ReceiptCommand {
    if (record.receiptCommand) {
      return record.receiptCommand;
    }

    if (!record.ledgerEntryId) {
      throw new Error(
        'Ledger entry must exist before publishing receipt command',
      );
    }

    record.receiptCommand = {
      type: 'GenerateReceiptCommand',
      schema_version: '1',
      command_id: record.commandId,
      operation_id: record.operationId,
      transaction_id: record.transactionId,
      ledger_entry_id: record.ledgerEntryId,
      amount: command.body.amount,
      currency: command.body.currency,
      request_id: command.requestId,
      idempotency_key_hash: idempotencyKeyHash(idempotencyKey),
      producer_service: 'transaction-api',
      producer_version: command.version,
      created_at: new Date().toISOString(),
    };

    return record.receiptCommand;
  }

  private validIdempotencyKey(idempotencyKey: string | undefined): string {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw invalidIdempotencyKey();
    }

    return idempotencyKey;
  }
}
