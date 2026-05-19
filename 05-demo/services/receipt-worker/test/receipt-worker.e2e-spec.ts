import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { SqsReceiptConsumer } from '../src/receipt/infrastructure/sqs-receipt.consumer';

const receiptQueueUrl = 'http://localhost:4566/000000000000/receipt-commands';

describe('receipt-worker e2e', () => {
  let app: INestApplication<App>;
  let originalEnv: NodeJS.ProcessEnv;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env = {
      ...process.env,
      AWS_REGION: 'us-east-1',
      AWS_ENDPOINT_URL: 'http://localhost:4566',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      SQS_QUEUE_URL: receiptQueueUrl,
      SQS_WAIT_TIME_SECONDS: '0',
      SQS_POLLING_ENABLED: 'false',
      SERVICE_VERSION: 'stable',
      GIT_COMMIT: 'e2e',
    };

    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app?.close();
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
            sqs: 'ready',
          },
        }),
      http().get('/version').expect(200, {
        service: 'receipt-worker',
        version: 'stable',
        commit: 'e2e',
      }),
    ]);
  });

  it('consumes, processes and deletes a receipt command', async () => {
    const sqs = new SQSClient({
      region: 'us-east-1',
      endpoint: 'http://localhost:4566',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const operationId = `op_worker_${Date.now()}`;

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: receiptQueueUrl,
        MessageBody: JSON.stringify({
          type: 'GenerateReceiptCommand',
          schema_version: '1',
          command_id: `cmd_${operationId}`,
          operation_id: operationId,
          transaction_id: `tx_${operationId}`,
          ledger_entry_id: `led_${operationId}`,
          amount: 100,
          currency: 'ARS',
          request_id: `req_${operationId}`,
          idempotency_key_hash: 'sha256:e2e',
          producer_service: 'transaction-api',
          producer_version: 'v1',
          created_at: new Date().toISOString(),
        }),
      }),
    );

    const consumer = app.get(SqsReceiptConsumer);
    await consumer.consumeOnce();

    const metrics = await http().get('/metrics').expect(200);
    expect(metrics.text).toContain(
      'receipt_processed_total{service="receipt-worker",status="success",version="v1"} 1',
    );
    expect(metrics.text).toContain(
      'sqs_delete_total{service="receipt-worker",queue="receipt-commands",status="success",version="v1"} 1',
    );
  });
});
