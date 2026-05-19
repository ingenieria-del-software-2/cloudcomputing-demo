import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';

type TxAccepted = {
  operation_id: string;
  transaction_id: string;
  ledger_entry_id: string;
  receipt_status: 'queued';
  version: string;
};

const receiptQueueUrl = 'http://localhost:4566/000000000000/receipt-commands';

describe('transaction-api e2e', () => {
  let app: INestApplication<App>;
  let originalEnv: NodeJS.ProcessEnv;
  let sqs: SQSClient;

  const http = () => request(app.getHttpServer());

  const postTx = (
    key: string,
    requestId: string,
    body: Partial<{
      amount: number;
      currency: string;
      description: string;
    }> = {},
  ) =>
    http()
      .post('/transactions')
      .set({
        'Idempotency-Key': key,
        'x-request-id': requestId,
      })
      .send({
        amount: 100,
        currency: 'ARS',
        description: 'e2e',
        ...body,
      });

  beforeAll(async () => {
    originalEnv = { ...process.env };

    process.env = {
      ...process.env,
      LEDGER_BASE_URL: process.env.LEDGER_BASE_URL ?? 'http://127.0.0.1:3001',
      LEDGER_TIMEOUT_MS: '500',
      READY_CHECK_TIMEOUT_MS: '500',
      SQS_QUEUE_URL: receiptQueueUrl,
      SQS_PUBLISH_MAX_ATTEMPTS: '2',
      SQS_PUBLISH_RETRY_DELAY_MS: '0',
      SERVICE_VERSION: 'v1',
      GIT_COMMIT: 'e2e',
    };
    delete process.env.SQS_ENDPOINT;

    sqs = new SQSClient({
      region: 'us-east-1',
      endpoint: 'http://localhost:4566',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });

    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app?.close();
    sqs?.destroy();
    process.env = originalEnv;
  }, 60000);

  it('exposes operational HTTP endpoints', async () => {
    await Promise.all([
      http().get('/healthz').expect(200, { status: 'ok' }),
      http()
        .get('/readyz')
        .expect(200, {
          status: 'ready',
          dependencies: {
            ledger_service: 'ready',
            sqs: 'ready',
          },
        }),
      http().get('/version').expect(200, {
        service: 'transaction-api',
        version: 'v1',
        commit: 'e2e',
      }),
    ]);
  });

  it('client creates a transaction over HTTP', async () => {
    const created = await postTx(`e2e-${Date.now()}`, 'req_e2e_001').expect(
      202,
    );

    const tx = created.body as TxAccepted;

    expect(tx).toMatchObject({
      receipt_status: 'queued',
      version: 'v1',
    });
    expect(tx.operation_id).toMatch(/^op_/);
    expect(tx.transaction_id).toMatch(/^tx_/);
    expect(tx.ledger_entry_id).toMatch(/^led_/);
    expect(created.headers['x-request-id']).toBe('req_e2e_001');

    const metrics = await http().get('/metrics').expect(200);

    expect(metrics.text).toContain(
      'sqs_publish_total{service="transaction-api",queue="receipt-commands",status="success",version="v1"} 1',
    );
  });

  it('uses generated request ids in receipt commands when the header is missing', async () => {
    const created = await http()
      .post('/transactions')
      .set({ 'Idempotency-Key': `e2e-generated-request-${Date.now()}` })
      .send({
        amount: 100,
        currency: 'ARS',
        description: 'e2e generated request id',
      })
      .expect(202);

    const generatedRequestId = created.headers['x-request-id'];
    const tx = created.body as TxAccepted;
    const receiptCommand = await receiveReceiptCommand(tx.operation_id);

    expect(generatedRequestId).toMatch(/^req_/);
    expect(receiptCommand.request_id).toBe(generatedRequestId);
  });

  it('replays idempotent HTTP retries', async () => {
    const key = `e2e-replay-${Date.now()}`;
    const payload = { description: 'e2e replay' };

    const first = await postTx(key, 'req_e2e_replay_001', payload).expect(202);
    const second = await postTx(key, 'req_e2e_replay_001', payload).expect(202);

    expect(second.body).toEqual(first.body);
  });

  it('rejects idempotency key reuse with a different payload', async () => {
    const key = `e2e-conflict-${Date.now()}`;

    const accepted = await postTx(key, 'req_e2e_conflict_001', {
      description: 'e2e conflict',
    }).expect(202);

    await postTx(key, 'req_e2e_conflict_002', {
      amount: 200,
      description: 'e2e conflict',
    })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 409,
          code: 'IDEMPOTENCY_CONFLICT',
          request_id: 'req_e2e_conflict_002',
          operation_id: (accepted.body as TxAccepted).operation_id,
        });
      });
  });

  async function receiveReceiptCommand(operationId: string) {
    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: receiptQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );

      for (const message of response.Messages ?? []) {
        const command = message.Body
          ? (JSON.parse(message.Body) as Record<string, unknown>)
          : {};

        if (message.ReceiptHandle) {
          await sqs.send(
            new DeleteMessageCommand({
              QueueUrl: receiptQueueUrl,
              ReceiptHandle: message.ReceiptHandle,
            }),
          );
        }

        if (command.operation_id === operationId) {
          return command;
        }
      }
    }

    throw new Error(`receipt command not found for ${operationId}`);
  }
});
