import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { FaultInjector } from '../../common/fault-injection/config-fault.injector';
import type { ReceiptCommand } from '../application/transaction.ports';
import { SqsReceiptQueuePublisher } from './sqs-receipt-queue.publisher';

describe('SqsReceiptQueuePublisher', () => {
  const command: ReceiptCommand = {
    type: 'GenerateReceiptCommand',
    schema_version: '1',
    command_id: 'cmd_001',
    operation_id: 'op_001',
    transaction_id: 'tx_001',
    ledger_entry_id: 'led_001',
    amount: 100,
    currency: 'ARS',
    request_id: 'req_001',
    idempotency_key_hash: 'sha256:abc123',
    producer_service: 'transaction-api',
    producer_version: 'v1',
    created_at: '2026-05-03T23:00:00.000Z',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends GenerateReceiptCommand to the configured SQS queue', async () => {
    const send = jest
      .spyOn(SQSClient.prototype, 'send')
      .mockReturnValueOnce(Promise.resolve({}) as never);
    const publisher = new SqsReceiptQueuePublisher(
      new ConfigService({
        AWS_REGION: 'us-east-1',
        SQS_ENDPOINT: 'http://localhost:4566',
        SQS_QUEUE_URL: 'http://localhost:4566/000000000000/receipt-commands',
      }),
      noopFailureInjector(),
    );

    await publisher.publish(command);

    expect(send.mock.calls).toHaveLength(1);
    const input = sentCommandInput(send.mock.calls[0]?.[0]);
    expect(input).toEqual(
      expect.objectContaining({
        QueueUrl: 'http://localhost:4566/000000000000/receipt-commands',
      }),
    );

    expect(JSON.parse(input.MessageBody ?? '{}') as ReceiptCommand).toEqual(
      command,
    );
  });

  it('propagates SQS send failures', async () => {
    jest
      .spyOn(SQSClient.prototype, 'send')
      .mockReturnValue(Promise.reject(new Error('sqs failed')) as never);
    const publisher = new SqsReceiptQueuePublisher(
      new ConfigService({
        SQS_PUBLISH_MAX_ATTEMPTS: '1',
      }),
      noopFailureInjector(),
    );

    await expect(publisher.publish(command)).rejects.toThrow('sqs failed');
  });

  it('retries SQS publish and keeps the same message body', async () => {
    const send = jest
      .spyOn(SQSClient.prototype, 'send')
      .mockReturnValueOnce(
        Promise.reject(new Error('temporary sqs failure')) as never,
      )
      .mockReturnValueOnce(Promise.resolve({}) as never);
    const publisher = new SqsReceiptQueuePublisher(
      new ConfigService({
        SQS_PUBLISH_MAX_ATTEMPTS: '2',
        SQS_PUBLISH_RETRY_DELAY_MS: '0',
      }),
      noopFailureInjector(),
    );

    await publisher.publish(command);

    expect(send.mock.calls).toHaveLength(2);
    const first = sentCommandInput(send.mock.calls[0]?.[0]);
    const second = sentCommandInput(send.mock.calls[1]?.[0]);
    expect(first.MessageBody).toBe(second.MessageBody);
    expect(JSON.parse(first.MessageBody ?? '{}') as ReceiptCommand).toEqual(
      command,
    );
  });

  it('uses SQS_PUBLISH_MAX_ATTEMPTS before propagating permanent failures', async () => {
    const send = jest
      .spyOn(SQSClient.prototype, 'send')
      .mockReturnValue(
        Promise.reject(new Error('permanent sqs failure')) as never,
      );
    const publisher = new SqsReceiptQueuePublisher(
      new ConfigService({
        SQS_PUBLISH_MAX_ATTEMPTS: '3',
        SQS_PUBLISH_RETRY_DELAY_MS: '0',
      }),
      noopFailureInjector(),
    );

    await expect(publisher.publish(command)).rejects.toThrow(
      'permanent sqs failure',
    );
    expect(send.mock.calls).toHaveLength(3);
  });
});

function noopFailureInjector(): FaultInjector {
  return {
    beforeRequest: () => Promise.resolve(),
    afterSuccessfulRequest: () => Promise.resolve(),
    beforeOperation: () => undefined,
  };
}

function sentCommandInput(command: unknown): {
  QueueUrl?: string;
  MessageBody?: string;
} {
  return (
    (command as { input?: { QueueUrl?: string; MessageBody?: string } })
      .input ?? {}
  );
}
