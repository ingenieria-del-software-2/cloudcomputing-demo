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
import { OrderService } from '../src/order/order.service';

type OrderResponse = {
  order_id: string;
  payment_id: string;
  status: 'ORDER_CONFIRMED' | 'DUPLICATE_PAYMENT_IGNORED';
  duplicate: boolean;
  version: string;
};

type EventEnvelope = {
  event_id: string;
  event_name: string;
  event_version: string;
  producer: string;
  correlation_id: string;
  causation_id: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
};

const queueUrl = 'http://localhost:4566/000000000000/orders-confirmed-intake';
const dlqArn = 'arn:aws:sqs:us-east-1:000000000000:orders-confirmed-dlq';
const paymentQueueUrl =
  'http://localhost:4566/000000000000/payments-approved-intake';
const paymentDlqArn =
  'arn:aws:sqs:us-east-1:000000000000:payments-approved-dlq';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://order:order@localhost:15432/order_management';

describe('order-management ATDD', () => {
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
      GIT_COMMIT: 'e2e',
      DATABASE_URL: databaseUrl,
      IDEMPOTENCY_ENABLED: 'true',
      PAYMENT_INTAKE_CONSUMER_ENABLED: 'true',
      PAYMENT_INTAKE_SQS_QUEUE_URL: paymentQueueUrl,
      SERVICE_VERSION: 'v1',
      SQS_QUEUE_URL: queueUrl,
      SQS_WAIT_TIME_SECONDS: '1',
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
    await sqs.send(
      new CreateQueueCommand({ QueueName: 'payments-approved-dlq' }),
    );
    await sqs.send(
      new CreateQueueCommand({
        QueueName: 'payments-approved-intake',
        Attributes: {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: paymentDlqArn,
            maxReceiveCount: '3',
          }),
        },
      }),
    );
    await sqs.send(
      new CreateQueueCommand({ QueueName: 'orders-confirmed-dlq' }),
    );
    await sqs.send(
      new CreateQueueCommand({
        QueueName: 'orders-confirmed-intake',
        Attributes: {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: dlqArn,
            maxReceiveCount: '3',
          }),
        },
      }),
    );

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
      service: 'order-management',
      version: 'v1',
      commit: 'e2e',
    });
  });

  it('configures a DLQ redrive policy for orders-confirmed-intake', async () => {
    const response = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['RedrivePolicy'],
      }),
    );

    expect(JSON.parse(response.Attributes?.RedrivePolicy ?? '{}')).toEqual({
      deadLetterTargetArn: dlqArn,
      maxReceiveCount: '3',
    });
  });

  it('creates an order from an approved payment and publishes order_confirmed', async () => {
    const paymentId = `pay_e2e_${Date.now()}`;
    const created = await postPayment(paymentId, 'cart_bf_001').expect(201);
    const order = created.body as OrderResponse;

    expect(order).toMatchObject({
      payment_id: paymentId,
      status: 'ORDER_CONFIRMED',
      duplicate: false,
      version: 'v1',
    });
    expect(order.order_id).toMatch(/^ord_/);

    await http()
      .get(`/orders/${order.order_id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          order_id: order.order_id,
          payment_id: paymentId,
          status: 'ORDER_CONFIRMED',
        });
      });

    await expect(dbOrderPaymentId(order.order_id)).resolves.toBe(paymentId);
    await expect(dbOrderItemCount(order.order_id)).resolves.toBe(1);
    await expect(dbOrderTransitionCount(order.order_id)).resolves.toBe(1);

    const event = await receiveEvent(
      'orders.order_confirmed.v1',
      order.order_id,
    );
    expect(event).toMatchObject({
      event_name: 'orders.order_confirmed.v1',
      event_version: '1.0',
      producer: 'order-management',
      correlation_id: 'checkout_e2e_001',
      idempotency_key: `payment_id:${paymentId}`,
    });
    expect(event.event_id).toMatch(/^evt_/);
    expect(event.payload).toMatchObject({
      order_id: order.order_id,
      payment_id: paymentId,
      buyer_id: 'buyer_918273',
      seller_id: 'seller_445566',
    });
    expect(event.payload.payment_approved_at).toBeDefined();

    const metrics = await http().get('/metrics').expect(200);
    expect(metrics.text).toContain(
      'orders_total{service="order-management",status="confirmed",version="v1"}',
    );
    expect(metrics.text).toContain(
      'order_confirmation_within_5s_ratio{service="order-management",version="v1"} 1',
    );
  });

  it('consumes payments.payment_approved from the optional SQS intake', async () => {
    const paymentId = `pay_sqs_intake_${Date.now()}`;

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: paymentQueueUrl,
        MessageBody: JSON.stringify(paymentApprovedEvent(paymentId)),
      }),
    );

    const order = await waitForOrderByPaymentId(paymentId);
    const event = await receiveEvent(
      'orders.order_confirmed.v1',
      order.order_id,
    );
    expect(event.causation_id).toBe(`evt_${paymentId}`);
  });

  it('ignores duplicate payments without creating a second order', async () => {
    const paymentId = `pay_duplicate_${Date.now()}`;

    const first = await postPayment(paymentId, 'cart_dup_001').expect(201);
    const second = await postPayment(paymentId, 'cart_dup_001').expect(200);

    expect(second.body).toMatchObject({
      order_id: (first.body as OrderResponse).order_id,
      payment_id: paymentId,
      status: 'DUPLICATE_PAYMENT_IGNORED',
      duplicate: true,
    });

    await receiveEvent(
      'orders.duplicate_payment_ignored.v1',
      (first.body as OrderResponse).order_id,
    );

    const metrics = await http().get('/metrics').expect(200);
    expect(metrics.text).toContain(
      'duplicate_order_attempts_total{service="order-management",version="v1"} 1',
    );
  });

  it('creates duplicate orders when idempotency is disabled', async () => {
    const paymentId = `pay_idempotency_off_${Date.now()}`;
    const config = new ConfigService({
      AWS_ACCESS_KEY_ID: 'test',
      AWS_ENDPOINT_URL: 'http://localhost:4566',
      AWS_REGION: 'us-east-1',
      AWS_SECRET_ACCESS_KEY: 'test',
      DATABASE_URL: databaseUrl,
      IDEMPOTENCY_ENABLED: 'false',
      SERVICE_VERSION: 'v1',
      SQS_QUEUE_URL: queueUrl,
    });
    const nonIdempotentService = new OrderService(
      config,
      new MetricsService(config),
      loggerMock(),
    );
    await nonIdempotentService.onModuleInit();

    const first = await nonIdempotentService.approvePayment({
      body: paymentPayload(paymentId, 'cart_idempotency_off_001'),
      correlationId: 'checkout_idempotency_off_001',
      requestId: `req_first_${paymentId}`,
    });
    const second = await nonIdempotentService.approvePayment({
      body: paymentPayload(paymentId, 'cart_idempotency_off_001'),
      correlationId: 'checkout_idempotency_off_001',
      requestId: `req_second_${paymentId}`,
    });
    await nonIdempotentService.onModuleDestroy();

    expect(first).toMatchObject({
      payment_id: paymentId,
      status: 'ORDER_CONFIRMED',
      duplicate: false,
    });
    expect(second).toMatchObject({
      payment_id: paymentId,
      status: 'ORDER_CONFIRMED',
      duplicate: false,
    });
    expect(second.order_id).not.toBe(first.order_id);
    await expect(dbOrderCount(paymentId)).resolves.toBe(2);

    await receiveEvents('orders.order_confirmed.v1', [
      first.order_id,
      second.order_id,
    ]);
  });

  it('publishes order_confirmation_failed when persistence fails', async () => {
    const paymentId = `pay_failure_${Date.now()}`;
    const config = new ConfigService({
      AWS_ACCESS_KEY_ID: 'test',
      AWS_ENDPOINT_URL: 'http://localhost:4566',
      AWS_REGION: 'us-east-1',
      AWS_SECRET_ACCESS_KEY: 'test',
      DATABASE_URL: 'postgresql://order:order@127.0.0.1:1/order_management',
      SERVICE_VERSION: 'v1',
      SQS_QUEUE_URL: queueUrl,
    });
    const failingService = new OrderService(
      config,
      new MetricsService(config),
      loggerMock(),
    );

    await expect(
      failingService.approvePayment({
        body: paymentPayload(paymentId, 'cart_failure_001'),
        correlationId: 'checkout_failure_001',
        requestId: `req_${paymentId}`,
      }),
    ).rejects.toHaveProperty('response.code', 'ORDER_CONFIRMATION_FAILED');
    await failingService.onModuleDestroy();

    const event = await receiveEventByPayment(
      'orders.order_confirmation_failed.v1',
      paymentId,
    );
    expect(event).toMatchObject({
      event_name: 'orders.order_confirmation_failed.v1',
      producer: 'order-management',
      correlation_id: 'checkout_failure_001',
      idempotency_key: `payment_id:${paymentId}`,
    });
    expect(event.payload).toMatchObject({
      payment_id: paymentId,
      business_error_code: 'ORDER_PERSISTENCE_FAILED',
    });
  });

  it('cancels an order after fulfillment publishes commitment_failed', async () => {
    const paymentId = `pay_cancel_${Date.now()}`;
    const created = await postPayment(paymentId, 'cart_cancel_001').expect(201);
    const order = created.body as OrderResponse;
    await receiveEvent('orders.order_confirmed.v1', order.order_id);

    const cancelled = await http()
      .post('/internal/fulfillment/failed')
      .set({ 'x-request-id': `req_cancel_${paymentId}` })
      .send(fulfillmentFailedEvent(order.order_id))
      .expect(202);

    expect(cancelled.body).toMatchObject({
      order_id: order.order_id,
      payment_id: paymentId,
      status: 'ORDER_CANCELLED',
      duplicate: false,
      reason: 'STOCK_UNAVAILABLE',
    });
    await expect(dbOrderStatus(order.order_id)).resolves.toBe(
      'ORDER_CANCELLED',
    );
    await expect(dbOrderTransitionCount(order.order_id)).resolves.toBe(2);

    const event = await receiveEvent(
      'orders.order_cancelled.v1',
      order.order_id,
    );
    expect(event).toMatchObject({
      event_name: 'orders.order_cancelled.v1',
      producer: 'order-management',
      correlation_id: `checkout_${order.order_id}`,
      idempotency_key: `order_id:${order.order_id}:cancellation`,
    });
    expect(event.payload).toMatchObject({
      order_id: order.order_id,
      payment_id: paymentId,
      reason: 'STOCK_UNAVAILABLE',
    });
    expect(typeof event.payload.payment_approved_at).toBe('string');
  });

  it('persists the order and republishes the outbox when SQS is temporarily unavailable', async () => {
    const paymentId = `pay_outbox_${Date.now()}`;
    const failingConfig = new ConfigService({
      AWS_ACCESS_KEY_ID: 'test',
      AWS_ENDPOINT_URL: 'http://127.0.0.1:1',
      AWS_REGION: 'us-east-1',
      AWS_SECRET_ACCESS_KEY: 'test',
      DATABASE_URL: databaseUrl,
      OUTBOX_PUBLISHER_ENABLED: 'false',
      SERVICE_VERSION: 'v1',
      SQS_QUEUE_URL: queueUrl,
    });
    const failingService = new OrderService(
      failingConfig,
      new MetricsService(failingConfig),
      loggerMock(),
    );
    await failingService.onModuleInit();

    const result = await failingService.approvePayment({
      body: paymentPayload(paymentId, 'cart_outbox_001'),
      correlationId: 'checkout_outbox_001',
      requestId: `req_${paymentId}`,
    });
    await failingService.onModuleDestroy();

    expect(result).toMatchObject({
      payment_id: paymentId,
      status: 'ORDER_CONFIRMED',
      duplicate: false,
    });
    await expect(dbOrderPaymentId(result.order_id)).resolves.toBe(paymentId);
    await expect(dbOutboxPendingCount(result.order_id)).resolves.toBe(1);

    const recoveryConfig = new ConfigService({
      AWS_ACCESS_KEY_ID: 'test',
      AWS_ENDPOINT_URL: 'http://localhost:4566',
      AWS_REGION: 'us-east-1',
      AWS_SECRET_ACCESS_KEY: 'test',
      DATABASE_URL: databaseUrl,
      OUTBOX_POLL_INTERVAL_MS: '100',
      SERVICE_VERSION: 'v1',
      SQS_QUEUE_URL: queueUrl,
    });
    const recoveryService = new OrderService(
      recoveryConfig,
      new MetricsService(recoveryConfig),
      loggerMock(),
    );
    await recoveryService.onModuleInit();

    await receiveEvent('orders.order_confirmed.v1', result.order_id);
    await recoveryService.onModuleDestroy();
    await expect(dbOutboxPendingCount(result.order_id)).resolves.toBe(0);
  });

  function postPayment(paymentId: string, cartId: string) {
    return http()
      .post('/internal/payments/approved')
      .set({
        'x-correlation-id': 'checkout_e2e_001',
        'x-request-id': `req_${paymentId}`,
      })
      .send(paymentPayload(paymentId, cartId));
  }

  async function receiveEvent(
    eventName: string,
    orderId: string,
  ): Promise<EventEnvelope> {
    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );

      for (const message of response.Messages ?? []) {
        const event = message.Body
          ? (JSON.parse(message.Body) as EventEnvelope)
          : undefined;

        if (message.ReceiptHandle) {
          await sqs.send(
            new DeleteMessageCommand({
              QueueUrl: queueUrl,
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

  async function receiveEvents(
    eventName: string,
    orderIds: string[],
  ): Promise<EventEnvelope[]> {
    const deadline = Date.now() + 5000;
    const remaining = new Set(orderIds);
    const events: EventEnvelope[] = [];

    while (Date.now() < deadline && remaining.size > 0) {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );

      for (const message of response.Messages ?? []) {
        const event = message.Body
          ? (JSON.parse(message.Body) as EventEnvelope)
          : undefined;

        if (message.ReceiptHandle) {
          await sqs.send(
            new DeleteMessageCommand({
              QueueUrl: queueUrl,
              ReceiptHandle: message.ReceiptHandle,
            }),
          );
        }

        const orderId = event?.payload.order_id;
        if (
          event?.event_name === eventName &&
          typeof orderId === 'string' &&
          remaining.has(orderId)
        ) {
          events.push(event);
          remaining.delete(orderId);
        }
      }
    }

    if (remaining.size === 0) {
      return events;
    }

    throw new Error(
      `${eventName} not found for ${Array.from(remaining).join(', ')}`,
    );
  }

  async function receiveEventByPayment(
    eventName: string,
    paymentId: string,
  ): Promise<EventEnvelope> {
    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );

      for (const message of response.Messages ?? []) {
        const event = message.Body
          ? (JSON.parse(message.Body) as EventEnvelope)
          : undefined;

        if (message.ReceiptHandle) {
          await sqs.send(
            new DeleteMessageCommand({
              QueueUrl: queueUrl,
              ReceiptHandle: message.ReceiptHandle,
            }),
          );
        }

        if (
          event?.event_name === eventName &&
          event.payload.payment_id === paymentId
        ) {
          return event;
        }
      }
    }

    throw new Error(`${eventName} not found for ${paymentId}`);
  }

  async function dbOrderPaymentId(
    orderId: string,
  ): Promise<string | undefined> {
    const result = await db.query<{ payment_id: string }>(
      'SELECT payment_id FROM orders WHERE order_id = $1',
      [orderId],
    );

    return result.rows[0]?.payment_id;
  }

  async function waitForOrderByPaymentId(
    paymentId: string,
  ): Promise<{ order_id: string }> {
    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {
      const result = await db.query<{ order_id: string }>(
        'SELECT order_id FROM orders WHERE payment_id = $1 LIMIT 1',
        [paymentId],
      );

      if (result.rows[0]) {
        return result.rows[0];
      }

      await sleep(100);
    }

    throw new Error(`order was not created for ${paymentId}`);
  }

  async function dbOrderStatus(orderId: string): Promise<string | undefined> {
    const result = await db.query<{ status: string }>(
      'SELECT status FROM orders WHERE order_id = $1',
      [orderId],
    );

    return result.rows[0]?.status;
  }

  async function dbOrderItemCount(orderId: string): Promise<number> {
    const result = await db.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM order_items WHERE order_id = $1',
      [orderId],
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async function dbOrderTransitionCount(orderId: string): Promise<number> {
    const result = await db.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM order_state_transitions WHERE order_id = $1',
      [orderId],
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async function dbOutboxPendingCount(orderId: string): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM event_outbox
       WHERE payload->'payload'->>'order_id' = $1
         AND status <> 'PUBLISHED'`,
      [orderId],
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async function dbOrderCount(paymentId: string): Promise<number> {
    const result = await db.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM orders WHERE payment_id = $1',
      [paymentId],
    );

    return Number(result.rows[0]?.count ?? 0);
  }
});

function paymentPayload(paymentId: string, cartId: string) {
  return {
    payment_id: paymentId,
    cart_id: cartId,
    buyer_id: 'buyer_918273',
    seller_id: 'seller_445566',
    site_id: 'MLA',
    currency: 'ARS',
    gross_amount: 52999.99,
    items: [
      {
        item_id: 'CFB123456',
        seller_sku: 'MATE-STANLEY-NO-OFICIAL',
        quantity: 1,
        unit_price: 52999.99,
      },
    ],
  };
}

function paymentApprovedEvent(paymentId: string) {
  const occurredAt = new Date().toISOString();

  return {
    event_id: `evt_${paymentId}`,
    event_name: 'payments.payment_approved.v1',
    event_version: '1.0',
    occurred_at: occurredAt,
    producer: 'payments-core',
    correlation_id: `checkout_${paymentId}`,
    causation_id: `pay_${paymentId}`,
    idempotency_key: `payment_id:${paymentId}`,
    payload: {
      ...paymentPayload(paymentId, `cart_${paymentId}`),
      payment_approved_at: occurredAt,
    },
  };
}

function fulfillmentFailedEvent(orderId: string) {
  const occurredAt = new Date().toISOString();

  return {
    event_id: `evt_fulfillment_failed_${orderId}`,
    event_name: 'fulfillment.commitment_failed.v1',
    event_version: '1.0',
    occurred_at: occurredAt,
    producer: 'fulfillment-planning',
    correlation_id: `checkout_${orderId}`,
    causation_id: `evt_order_${orderId}`,
    idempotency_key: `order_id:${orderId}`,
    payload: {
      order_id: orderId,
      payment_approved_at: occurredAt,
      reason: 'STOCK_UNAVAILABLE',
      failed_items: [
        {
          seller_sku: 'MATE-STANLEY-NO-OFICIAL',
          requested_quantity: 2,
          available_quantity: 0,
        },
      ],
      failed_at: occurredAt,
    },
  };
}

function loggerMock(): jest.Mocked<StructuredLoggerService> {
  return {
    info: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<StructuredLoggerService>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
