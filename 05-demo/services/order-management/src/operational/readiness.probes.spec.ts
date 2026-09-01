import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PostgresReadinessProbe, SqsReadinessProbe } from './readiness.probes';

describe('PostgresReadinessProbe', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns ready when Postgres responds to SELECT 1', async () => {
    const query = jest
      .spyOn(Pool.prototype, 'query')
      .mockResolvedValueOnce({ rows: [] } as never);
    jest.spyOn(Pool.prototype, 'end').mockResolvedValueOnce(undefined as never);

    await expect(
      new PostgresReadinessProbe(new ConfigService()).isReady(),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns not ready when Postgres query fails', async () => {
    jest
      .spyOn(Pool.prototype, 'query')
      .mockRejectedValueOnce(new Error('db unavailable') as never);
    jest.spyOn(Pool.prototype, 'end').mockResolvedValueOnce(undefined as never);

    await expect(
      new PostgresReadinessProbe(new ConfigService()).isReady(),
    ).resolves.toBe(false);
  });
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
        SQS_QUEUE_URL:
          'http://localhost:4566/000000000000/orders-confirmed-intake',
      }),
    );

    await expect(probe.isReady()).resolves.toBe(true);
    expect(send.mock.calls).toHaveLength(1);
    expect(sentCommandInput(send.mock.calls[0]?.[0])).toEqual(
      expect.objectContaining({
        QueueUrl: 'http://localhost:4566/000000000000/orders-confirmed-intake',
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
