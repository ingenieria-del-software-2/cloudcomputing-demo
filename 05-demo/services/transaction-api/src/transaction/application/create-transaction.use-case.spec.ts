import { CreateTransactionUseCase } from './create-transaction.use-case';
import { TransactionError } from './transaction.errors';
import {
  IdempotencyStore,
  LedgerPort,
  LedgerPortError,
  ReceiptPublisherPort,
  TransactionEvent,
  TransactionEventSink,
} from './transaction.ports';
import type { IdempotencyRecord } from '../domain/transaction';

describe('CreateTransactionUseCase', () => {
  const payload = {
    amount: 100,
    currency: 'ARS',
    description: 'demo',
  };

  let ledger: jest.Mocked<LedgerPort>;
  let receiptPublisher: jest.Mocked<ReceiptPublisherPort>;
  let idempotencyStore: MemoryStore;
  let events: jest.Mocked<TransactionEventSink>;
  let useCase: CreateTransactionUseCase;

  beforeEach(() => {
    ledger = {
      createEntry: jest.fn((input) =>
        Promise.resolve({
          ledgerEntryId: `led_${input.operationId.slice(3)}`,
          status: 'created',
        }),
      ),
    };
    receiptPublisher = {
      publish: jest.fn<
        ReturnType<ReceiptPublisherPort['publish']>,
        Parameters<ReceiptPublisherPort['publish']>
      >(() => Promise.resolve()),
    };
    idempotencyStore = new MemoryStore();
    events = {
      publish: jest.fn(),
    };
    useCase = new CreateTransactionUseCase({
      ledger,
      receiptPublisher,
      idempotencyStore,
      events,
    });
  });

  it('replays the same result for the same idempotency key and payload', async () => {
    const first = await execute('key-1', 'req_001');
    const second = await execute('key-1', 'req_002');

    expect(second).toEqual(first);
    expect(ledger.createEntry.mock.calls).toHaveLength(1);
    expect(receiptPublisher.publish.mock.calls).toHaveLength(1);
    expect(events.publish.mock.calls).toContainEqual([
      {
        type: 'idempotency_replay',
        requestId: 'req_002',
        response: first,
      } satisfies TransactionEvent,
    ]);
  });

  it('publishes the receipt command with idempotency key hash', async () => {
    await execute('key-1', 'req_001');

    expect(receiptPublisher.publish.mock.calls[0]?.[0]).toMatchObject({
      idempotency_key_hash:
        'sha256:be2974546978e3739e6d6da85c4be9f334ce32df2b9fd4b6ff1b55c0d57e9d44',
    });
  });

  it('rejects idempotency key reuse with a different payload', async () => {
    const accepted = await execute('key-1', 'req_001');

    await expect(
      useCase.execute({
        body: { ...payload, amount: 200 },
        idempotencyKey: 'key-1',
        requestId: 'req_002',
        version: 'v1',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'IDEMPOTENCY_CONFLICT',
      operationId: accepted.operation_id,
    } satisfies Partial<TransactionError>);
  });

  it('maps ledger timeout errors to application errors', async () => {
    ledger.createEntry.mockRejectedValueOnce(new LedgerPortError('timeout'));

    await expect(execute('key-timeout', 'req_timeout')).rejects.toMatchObject({
      status: 504,
      code: 'LEDGER_TIMEOUT',
      message: 'ledger-service timed out',
      requestId: 'req_timeout',
    } satisfies Partial<TransactionError>);
  });

  it('retries receipt publish without calling ledger again after partial failure', async () => {
    receiptPublisher.publish
      .mockRejectedValueOnce(new Error('publish failed'))
      .mockResolvedValueOnce();

    let operationId: string | undefined;
    try {
      await execute('key-partial', 'req_partial_1');
      throw new Error('Expected receipt publish failure');
    } catch (error) {
      expect(error).toBeInstanceOf(TransactionError);
      expect((error as TransactionError).status).toBe(503);
      operationId = (error as TransactionError).operationId;
    }

    const accepted = await execute('key-partial', 'req_partial_2');

    expect(accepted.operation_id).toBe(operationId);
    expect(ledger.createEntry.mock.calls).toHaveLength(1);
    expect(receiptPublisher.publish.mock.calls).toHaveLength(2);
    expect(receiptPublisher.publish.mock.calls[1]?.[0]).toEqual(
      receiptPublisher.publish.mock.calls[0]?.[0],
    );
  });

  it('retries ledger with the same operation id after an unconfirmed failure', async () => {
    ledger.createEntry
      .mockRejectedValueOnce(new Error('ledger failed'))
      .mockImplementationOnce((input) =>
        Promise.resolve({
          ledgerEntryId: `led_${input.operationId.slice(3)}`,
          status: 'created',
        }),
      );

    let operationId: string | undefined;
    try {
      await execute('key-ledger-retry', 'req_ledger_1');
      throw new Error('Expected ledger failure');
    } catch (error) {
      expect(error).toBeInstanceOf(TransactionError);
      expect((error as TransactionError).status).toBe(502);
      operationId = (error as TransactionError).operationId;
    }

    const accepted = await execute('key-ledger-retry', 'req_ledger_2');

    expect(accepted.operation_id).toBe(operationId);
    expect(ledger.createEntry.mock.calls).toHaveLength(2);
    expect(ledger.createEntry.mock.calls[1]?.[0].operationId).toBe(operationId);
    expect(receiptPublisher.publish.mock.calls).toHaveLength(1);
  });

  it('rejects payload changes after a partial receipt publish failure', async () => {
    receiptPublisher.publish.mockRejectedValueOnce(new Error('publish failed'));

    await expect(
      execute('key-partial-conflict', 'req_partial_1'),
    ).rejects.toBeInstanceOf(TransactionError);

    await expect(
      useCase.execute({
        body: { ...payload, amount: 200 },
        idempotencyKey: 'key-partial-conflict',
        requestId: 'req_partial_2',
        version: 'v1',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'IDEMPOTENCY_CONFLICT',
    } satisfies Partial<TransactionError>);
  });

  it('rejects missing idempotency keys', async () => {
    await expect(
      useCase.execute({
        body: payload,
        idempotencyKey: undefined,
        requestId: 'req_001',
        version: 'v1',
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    } satisfies Partial<TransactionError>);
  });

  function execute(idempotencyKey: string, requestId: string) {
    return useCase.execute({
      body: payload,
      idempotencyKey,
      requestId,
      version: 'v1',
    });
  }
});

class MemoryStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  get(idempotencyKey: string): IdempotencyRecord | undefined {
    return this.records.get(idempotencyKey);
  }

  set(idempotencyKey: string, record: IdempotencyRecord): void {
    this.records.set(idempotencyKey, record);
  }
}
