import { ConfigService } from '@nestjs/config';
import type {
  LedgerEntryRequest,
  LedgerPortError,
} from '../application/transaction.ports';
import { HttpLedgerClient } from './http-ledger.client';

describe('HttpLedgerClient', () => {
  const request: LedgerEntryRequest = {
    operationId: 'op_001',
    amount: 100,
    currency: 'ARS',
    idempotencyKey: 'key-1',
    requestId: 'req_001',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts ledger entry requests with correlation headers', async () => {
    const fetch = mockFetch(
      jsonResponse(201, {
        ledger_entry_id: 'led_001',
        operation_id: 'op_001',
        status: 'created',
      }),
    );

    const response = await client().createEntry(request);

    expect(response).toEqual({
      ledgerEntryId: 'led_001',
      status: 'created',
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://ledger-service/ledger/entries',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'key-1',
          'x-request-id': 'req_001',
        },
        body: JSON.stringify({
          operation_id: 'op_001',
          amount: 100,
          currency: 'ARS',
        }),
        signal: expect.any(AbortSignal) as AbortSignal,
      }),
    );
  });

  it('accepts idempotent replay responses from ledger', async () => {
    mockFetch(
      jsonResponse(200, {
        ledger_entry_id: 'led_001',
        operation_id: 'op_001',
        status: 'replayed',
      }),
    );

    await expect(client().createEntry(request)).resolves.toEqual({
      ledgerEntryId: 'led_001',
      status: 'replayed',
    });
  });

  it('maps non-2xx responses to failed ledger errors', async () => {
    mockFetch(jsonResponse(500, { status: 500 }));

    await expect(client().createEntry(request)).rejects.toMatchObject({
      kind: 'failed',
    } satisfies Partial<LedgerPortError>);
  });

  it('maps invalid response bodies to failed ledger errors', async () => {
    mockFetch(jsonResponse(201, { ledger_entry_id: 'led_001' }));

    await expect(client().createEntry(request)).rejects.toMatchObject({
      kind: 'failed',
    } satisfies Partial<LedgerPortError>);
  });

  it('maps aborts to timeout ledger errors', async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(error);

    await expect(client().createEntry(request)).rejects.toMatchObject({
      kind: 'timeout',
    } satisfies Partial<LedgerPortError>);
  });

  function client(): HttpLedgerClient {
    return new HttpLedgerClient(
      new ConfigService({
        LEDGER_BASE_URL: 'http://ledger-service',
        LEDGER_TIMEOUT_MS: 500,
      }),
    );
  }

  function mockFetch(response: Response): jest.SpiedFunction<typeof fetch> {
    return jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
  }

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
