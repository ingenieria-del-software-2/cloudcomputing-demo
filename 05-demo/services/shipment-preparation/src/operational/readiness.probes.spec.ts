import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import {
  PostgresReadinessProbe,
  S3ReadinessProbe,
  SqsReadinessProbe,
} from './readiness.probes';

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
          'http://localhost:4566/000000000000/fulfillment-commitment-intake',
        SQS_QUEUE_URL:
          'http://localhost:4566/000000000000/buyer-tracking-events',
      }),
    );

    await expect(probe.isReady()).resolves.toBe(true);
    expect(send.mock.calls).toHaveLength(2);
    expect(sentCommandInput(send.mock.calls[0]?.[0])).toEqual(
      expect.objectContaining({
        QueueUrl:
          'http://localhost:4566/000000000000/fulfillment-commitment-intake',
        AttributeNames: ['QueueArn'],
      }),
    );
    expect(sentCommandInput(send.mock.calls[1]?.[0])).toEqual(
      expect.objectContaining({
        QueueUrl: 'http://localhost:4566/000000000000/buyer-tracking-events',
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

describe('S3ReadinessProbe', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('checks configured S3 bucket', async () => {
    const send = jest
      .spyOn(S3Client.prototype, 'send')
      .mockReturnValueOnce(Promise.resolve({}) as never);
    const probe = new S3ReadinessProbe(
      new ConfigService({
        SHIPMENT_DOCUMENTS_BUCKET: 'seller-dispatch-documents-lab',
      }),
    );

    await expect(probe.isReady()).resolves.toBe(true);
    expect(sentS3CommandInput(send.mock.calls[0]?.[0])).toEqual(
      expect.objectContaining({ Bucket: 'seller-dispatch-documents-lab' }),
    );
  });

  it('returns not ready when the S3 bucket cannot be read', async () => {
    jest
      .spyOn(S3Client.prototype, 'send')
      .mockReturnValueOnce(
        Promise.reject(new Error('s3 unavailable')) as never,
      );

    await expect(
      new S3ReadinessProbe(new ConfigService()).isReady(),
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

function sentS3CommandInput(command: unknown): { Bucket?: string } {
  return (command as { input?: { Bucket?: string } }).input ?? {};
}
