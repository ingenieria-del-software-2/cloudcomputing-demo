import {
  CreateQueueCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { StructuredLoggerService } from '../src/logging/structured-logger.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { FulfillmentService } from '../src/fulfillment/fulfillment.service';
import { OrderConfirmedEventDto } from '../src/fulfillment/order-confirmed-event.dto';

type FulfillmentStatus =
  | 'FULFILLMENT_COMMITTED'
  | 'FULFILLMENT_FAILED'
  | 'FULFILLMENT_AT_RISK';

type FulfillmentResponse = {
  order_id: string;
  fulfillment_commitment_id: string;
  status: FulfillmentStatus;
  duplicate: boolean;
  version: string;
  reason?: string;
};

type FulfillmentEventEnvelope = {
  event_id: string;
  event_name: string;
  event_version: string;
  occurred_at: string;
  producer: string;
  correlation_id: string;
  causation_id: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
};

const inputQueueUrl =
  'http://localhost:4566/000000000000/orders-confirmed-intake';
const inputDlqArn = 'arn:aws:sqs:us-east-1:000000000000:orders-confirmed-dlq';
const outputQueueUrl =
  'http://localhost:4566/000000000000/fulfillment-commitment-intake';
const outputDlqArn =
  'arn:aws:sqs:us-east-1:000000000000:fulfillment-commitment-dlq';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://fulfillment:fulfillment@localhost:15433/fulfillment_planning';

describe('fulfillment-planning ATDD', () => {
  let app: INestApplication<App>;
  let originalEnv: NodeJS.ProcessEnv;
  let sqs: SQSClient;
  let db: Pool;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env = {
      ...process.env,
      AWS_ACCESS_KEY_ID: 'test',
      AWS_ENDPOINT_URL: 'http://localhost:4566',
      AWS_REGION: 'us-east-1',
      AWS_SECRET_ACCESS_KEY: 'test',
      DATABASE_URL: databaseUrl,
      GIT_COMMIT: 'e2e',
      INPUT_SQS_QUEUE_URL: inputQueueUrl,
      PROMESA_EXPRESS_ENABLED: 'false',
      PROMESA_EXPRESS_ERROR_RATE: '0',
      PROMESA_EXPRESS_LATENCY_MS: '0',
      SERVICE_VERSION: 'v1',
      SQS_QUEUE_URL: outputQueueUrl,
      SQS_WAIT_TIME_SECONDS: '1',
      WORKER_CONCURRENCY: '1',
      WORKER_ENABLED: 'true',
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
    db = new Pool({ connectionString: databaseUrl });
    await createQueues();

    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await db?.end();
    sqs?.destroy();
    process.env = originalEnv;
  }, 60000);

  it('exposes operational HTTP endpoints', async () => {
    await http().get('/health').expect(200, { status: 'ok' });
    await http().get('/healthz').expect(200, { status: 'ok' });
    await http()
      .get('/readyz')
      .expect(200, {
        status: 'ready',
        dependencies: {
          db: 'ready',
          sqs: 'ready',
        },
      });
    await http().get('/version').expect(200, {
      service: 'fulfillment-planning',
      version: 'v1',
      commit: 'e2e',
    });
  });

  it('configures a DLQ redrive policy for fulfillment-commitment-intake', async () => {
    const response = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: outputQueueUrl,
        AttributeNames: ['RedrivePolicy'],
      }),
    );

    expect(JSON.parse(response.Attributes?.RedrivePolicy ?? '{}')).toEqual({
      deadLetterTargetArn: outputDlqArn,
      maxReceiveCount: '3',
    });
  });

  it('commits fulfillment from an order_confirmed event and publishes commitment_confirmed', async () => {
    const orderId = `ord_fulfillment_${Date.now()}`;

    const created = await postOrderConfirmed(
      orderId,
      'CARPINCHO-USB-C',
      2,
    ).expect(202);
    const commitment = created.body as FulfillmentResponse;

    expect(commitment).toMatchObject({
      order_id: orderId,
      status: 'FULFILLMENT_COMMITTED',
      duplicate: false,
      version: 'v1',
    });
    expect(commitment.fulfillment_commitment_id).toMatch(/^fc_/);

    await http()
      .get(`/fulfillment/orders/${orderId}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as {
          order_id: string;
          status: FulfillmentStatus;
          fulfillment_model: string;
          reserved_items: Array<{ seller_sku: string; quantity: number }>;
        };
        expect(body).toMatchObject({
          order_id: orderId,
          status: 'FULFILLMENT_COMMITTED',
          fulfillment_model: 'standard',
        });
        expect(body.reserved_items).toEqual([
          expect.objectContaining({
            seller_sku: 'CARPINCHO-USB-C',
            quantity: 2,
          }),
        ]);
      });

    await http()
      .get('/inventory/CARPINCHO-USB-C')
      .expect(200)
      .expect((response) => {
        const body = response.body as { reserved_quantity: number };
        expect(body.reserved_quantity).toBeGreaterThanOrEqual(2);
      });

    const event = await receiveEvent(
      'fulfillment.commitment_confirmed.v1',
      orderId,
    );
    expect(event).toMatchObject({
      event_name: 'fulfillment.commitment_confirmed.v1',
      event_version: '1.0',
      producer: 'fulfillment-planning',
      correlation_id: `checkout_${orderId}`,
      idempotency_key: `order_id:${orderId}`,
    });
    expect(event.event_id).toMatch(/^evt_/);
    expect(event.payload).toMatchObject({
      order_id: orderId,
      fulfillment_commitment_id: commitment.fulfillment_commitment_id,
      seller_id: 'seller_445566',
      fulfillment_model: 'standard',
    });

    const metrics = await http().get('/metrics').expect(200);
    expect(metrics.text).toContain(
      'fulfillment_commitments_total{service="fulfillment-planning",status="committed",version="v1"}',
    );
  });

  it('ignores duplicate order_confirmed events without reserving stock twice', async () => {
    const orderId = `ord_duplicate_${Date.now()}`;
    const event = orderConfirmedEvent(orderId, 'CARPINCHO-USB-C', 1);

    const first = await http()
      .post('/internal/events')
      .set({ 'x-request-id': `req_first_${orderId}` })
      .send(event)
      .expect(202);
    const second = await http()
      .post('/internal/events')
      .set({ 'x-request-id': `req_second_${orderId}` })
      .send(event)
      .expect(200);

    expect(second.body).toMatchObject({
      order_id: orderId,
      fulfillment_commitment_id: (first.body as FulfillmentResponse)
        .fulfillment_commitment_id,
      status: 'FULFILLMENT_COMMITTED',
      duplicate: true,
    });
    await expect(dbReservationCount(orderId)).resolves.toBe(1);

    await receiveEvent('fulfillment.commitment_confirmed.v1', orderId);
  });

  it('publishes commitment_failed when stock is unavailable', async () => {
    const orderId = `ord_stockout_${Date.now()}`;

    const created = await postOrderConfirmed(
      orderId,
      'MATE-STANLEY-NO-OFICIAL',
      2,
    ).expect(202);

    expect(created.body).toMatchObject({
      order_id: orderId,
      status: 'FULFILLMENT_FAILED',
      duplicate: false,
      reason: 'STOCK_UNAVAILABLE',
    });
    await expect(dbReservationCount(orderId)).resolves.toBe(0);

    const event = await receiveEvent(
      'fulfillment.commitment_failed.v1',
      orderId,
    );
    expect(event).toMatchObject({
      event_name: 'fulfillment.commitment_failed.v1',
      producer: 'fulfillment-planning',
      correlation_id: `checkout_${orderId}`,
      idempotency_key: `order_id:${orderId}`,
    });
    expect(event.payload).toMatchObject({
      order_id: orderId,
      reason: 'STOCK_UNAVAILABLE',
      failed_items: [
        {
          seller_sku: 'MATE-STANLEY-NO-OFICIAL',
          requested_quantity: 2,
          available_quantity: 1,
        },
      ],
    });
  });

  it('publishes commitment_at_risk when Promesa Express fails', async () => {
    const orderId = `ord_promesa_${Date.now()}`;
    const config = new ConfigService({
      AWS_ACCESS_KEY_ID: 'test',
      AWS_ENDPOINT_URL: 'http://localhost:4566',
      AWS_REGION: 'us-east-1',
      AWS_SECRET_ACCESS_KEY: 'test',
      DATABASE_URL: databaseUrl,
      INPUT_SQS_QUEUE_URL: inputQueueUrl,
      PROMESA_EXPRESS_ENABLED: 'true',
      PROMESA_EXPRESS_ERROR_RATE: '1',
      PROMESA_EXPRESS_LATENCY_MS: '0',
      SERVICE_VERSION: 'v1',
      SQS_QUEUE_URL: outputQueueUrl,
      WORKER_ENABLED: 'false',
    });
    const riskyService = new FulfillmentService(
      config,
      new MetricsService(config),
      loggerMock(),
    );
    await riskyService.onModuleInit();

    const result = await riskyService.handleOrderConfirmed({
      event: orderConfirmedEvent(orderId, 'TECLADO-MECANICO-RUIDOSO', 1),
      requestId: `req_${orderId}`,
    });
    await riskyService.onModuleDestroy();

    expect(result).toMatchObject({
      order_id: orderId,
      status: 'FULFILLMENT_AT_RISK',
      duplicate: false,
      reason: 'PROMESA_EXPRESS_UNAVAILABLE',
    });

    const event = await receiveEvent(
      'fulfillment.commitment_at_risk.v1',
      orderId,
    );
    expect(event).toMatchObject({
      event_name: 'fulfillment.commitment_at_risk.v1',
      producer: 'fulfillment-planning',
      correlation_id: `checkout_${orderId}`,
      idempotency_key: `order_id:${orderId}`,
    });
    expect(event.payload).toMatchObject({
      order_id: orderId,
      fulfillment_model: 'standard',
      reason: 'PROMESA_EXPRESS_UNAVAILABLE',
    });
  });

  it('consumes order_confirmed from SQS and publishes commitment_confirmed', async () => {
    const orderId = `ord_worker_${Date.now()}`;
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: inputQueueUrl,
        MessageBody: JSON.stringify(
          orderConfirmedEvent(orderId, 'CARPINCHO-USB-C', 1),
        ),
      }),
    );

    await receiveEvent('fulfillment.commitment_confirmed.v1', orderId);
    await expect(dbCommitmentStatus(orderId)).resolves.toBe(
      'FULFILLMENT_COMMITTED',
    );
  });

  function postOrderConfirmed(
    orderId: string,
    sellerSku: string,
    quantity: number,
  ) {
    return http()
      .post('/internal/events')
      .set({ 'x-request-id': `req_${orderId}` })
      .send(orderConfirmedEvent(orderId, sellerSku, quantity));
  }

  async function receiveEvent(
    eventName: string,
    orderId: string,
  ): Promise<FulfillmentEventEnvelope> {
    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: outputQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );

      for (const message of response.Messages ?? []) {
        const event = message.Body
          ? (JSON.parse(message.Body) as FulfillmentEventEnvelope)
          : undefined;

        if (message.ReceiptHandle) {
          await sqs.send(
            new DeleteMessageCommand({
              QueueUrl: outputQueueUrl,
              ReceiptHandle: message.ReceiptHandle,
            }),
          );
        }

        if (
          event?.event_name === eventName &&
          event.payload.order_id === orderId
        ) {
          return event;
        }
      }
    }

    throw new Error(`${eventName} not found for ${orderId}`);
  }

  async function dbReservationCount(orderId: string): Promise<number> {
    const result = await db.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM inventory_reservations WHERE order_id = $1',
      [orderId],
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async function dbCommitmentStatus(
    orderId: string,
  ): Promise<string | undefined> {
    const result = await db.query<{ status: string }>(
      'SELECT status FROM fulfillment_commitments WHERE order_id = $1',
      [orderId],
    );

    return result.rows[0]?.status;
  }

  async function createQueues(): Promise<void> {
    await sqs.send(
      new CreateQueueCommand({ QueueName: 'orders-confirmed-dlq' }),
    );
    await sqs.send(
      new CreateQueueCommand({
        QueueName: 'orders-confirmed-intake',
        Attributes: {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: inputDlqArn,
            maxReceiveCount: '3',
          }),
        },
      }),
    );
    await sqs.send(
      new CreateQueueCommand({ QueueName: 'fulfillment-commitment-dlq' }),
    );
    await sqs.send(
      new CreateQueueCommand({
        QueueName: 'fulfillment-commitment-intake',
        Attributes: {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: outputDlqArn,
            maxReceiveCount: '3',
          }),
        },
      }),
    );
  }
});

function orderConfirmedEvent(
  orderId: string,
  sellerSku: string,
  quantity: number,
): OrderConfirmedEventDto {
  const occurredAt = new Date().toISOString();

  return {
    event_id: `evt_${orderId}`,
    event_name: 'orders.order_confirmed.v1',
    event_version: '1.0',
    occurred_at: occurredAt,
    producer: 'order-management',
    correlation_id: `checkout_${orderId}`,
    causation_id: `req_${orderId}`,
    idempotency_key: `payment_id:pay_${orderId}`,
    payload: {
      order_id: orderId,
      payment_id: `pay_${orderId}`,
      buyer_id: 'buyer_918273',
      seller_id: 'seller_445566',
      site_id: 'MLA',
      currency: 'ARS',
      gross_amount: 52999.99 * quantity,
      items: [
        {
          item_id: `item_${sellerSku}`,
          seller_sku: sellerSku,
          quantity,
          unit_price: 52999.99,
        },
      ],
      confirmed_at: occurredAt,
    },
  };
}

function loggerMock(): jest.Mocked<StructuredLoggerService> {
  return {
    info: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<StructuredLoggerService>;
}
