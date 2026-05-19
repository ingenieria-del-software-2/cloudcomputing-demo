import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PostgresReadinessProbe, SqsReadinessProbe } from './readiness.probes';

describe('PostgresReadinessProbe', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns ready when PostgreSQL answers SELECT 1', async () => {
    const query = jest.fn().mockResolvedValue({});
    const end = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(Pool.prototype, 'query').mockImplementation(query);
    jest.spyOn(Pool.prototype, 'end').mockImplementation(end);

    await expect(
      new PostgresReadinessProbe(new ConfigService()).isReady(),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(end).toHaveBeenCalled();
  });

  it('returns not ready when PostgreSQL fails', async () => {
    jest
      .spyOn(Pool.prototype, 'query')
      .mockImplementation(() => Promise.reject(new Error('db down')) as never);
    jest
      .spyOn(Pool.prototype, 'end')
      .mockImplementation(() => Promise.resolve(undefined) as never);

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
      .mockReturnValue(Promise.resolve({}) as never);
    const probe = new SqsReadinessProbe(
      new ConfigService({
        INPUT_SQS_QUEUE_URL:
          'http://localhost:4566/000000000000/orders-confirmed-intake',
        SQS_QUEUE_URL:
          'http://localhost:4566/000000000000/fulfillment-commitment-intake',
      }),
    );

    await expect(probe.isReady()).resolves.toBe(true);
    expect(send.mock.calls).toHaveLength(2);
    expect(sentCommandInput(send.mock.calls[0]?.[0])).toEqual(
      expect.objectContaining({
        QueueUrl: 'http://localhost:4566/000000000000/orders-confirmed-intake',
        AttributeNames: ['QueueArn'],
      }),
    );
    expect(sentCommandInput(send.mock.calls[1]?.[0])).toEqual(
      expect.objectContaining({
        QueueUrl:
          'http://localhost:4566/000000000000/fulfillment-commitment-intake',
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
