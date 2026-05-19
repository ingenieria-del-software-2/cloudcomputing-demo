import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import {
  HttpLedgerReadinessProbe,
  SqsReadinessProbe,
} from './readiness.probes';

describe('HttpLedgerReadinessProbe', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns ready when ledger readiness responds 200', async () => {
    const fetch = mockFetch(new Response(null, { status: 200 }));

    await expect(probe().isReady()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith('http://ledger-service/readyz', {
      method: 'GET',
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it('returns not ready when ledger readiness responds 500', async () => {
    mockFetch(new Response(null, { status: 500 }));

    await expect(probe().isReady()).resolves.toBe(false);
  });

  it('returns not ready when ledger readiness times out', async () => {
    mockFetch(Promise.reject(new Error('aborted')));

    await expect(probe().isReady()).resolves.toBe(false);
  });

  function probe(): HttpLedgerReadinessProbe {
    return new HttpLedgerReadinessProbe(
      new ConfigService({
        LEDGER_BASE_URL: 'http://ledger-service',
      }),
    );
  }

  function mockFetch(
    response: Response | Promise<Response>,
  ): jest.SpiedFunction<typeof fetch> {
    return jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
  }
});

describe('SqsReadinessProbe', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('checks configured SQS queue attributes', async () => {
    const send = jest
      .spyOn(SQSClient.prototype, 'send')
      .mockReturnValueOnce(Promise.resolve({}) as never);
    const probe = new SqsReadinessProbe(
      new ConfigService({
        SQS_QUEUE_URL: 'http://localhost:4566/000000000000/receipt-commands',
      }),
    );

    await expect(probe.isReady()).resolves.toBe(true);
    expect(send.mock.calls).toHaveLength(1);
    expect(sentCommandInput(send.mock.calls[0]?.[0])).toEqual(
      expect.objectContaining({
        QueueUrl: 'http://localhost:4566/000000000000/receipt-commands',
        AttributeNames: ['QueueArn'],
      }),
    );
  });

  it('returns not ready when SQS attributes cannot be read', async () => {
    jest
      .spyOn(SQSClient.prototype, 'send')
      .mockReturnValueOnce(
        Promise.reject(new Error('sqs unavailable')) as never,
      );

    await expect(
      new SqsReadinessProbe(new ConfigService()).isReady(),
    ).resolves.toBe(false);
  });
});

function sentCommandInput(command: unknown): {
  QueueUrl?: string;
  AttributeNames?: string[];
} {
  return (
    (command as { input?: { QueueUrl?: string; AttributeNames?: string[] } })
      .input ?? {}
  );
}
