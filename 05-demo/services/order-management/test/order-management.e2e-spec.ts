import {
  CreateQueueCommand,
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
  idempotency_key: string;
  payload: Record<string, unknown>;
};

const queueUrl = 'http://localhost:4566/000000000000/orders-confirmed-intake';

describe('order-management ATDD', () => {
  let app: INestApplication<App>;
  let originalEnv: NodeJS.ProcessEnv;
  let sqs: SQSClient;

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
      IDEMPOTENCY_ENABLED: 'true',
      SERVICE_VERSION: 'v1',
      SQS_QUEUE_URL: queueUrl,
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
    await sqs.send(
      new CreateQueueCommand({ QueueName: 'orders-confirmed-intake' }),
    );

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
      http().get('/health').expect(200, { status: 'ok' }),
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
        service: 'order-management',
        version: 'v1',
        commit: 'e2e',
      }),
    ]);
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

    const metrics = await http().get('/metrics').expect(200);
    expect(metrics.text).toContain(
      'orders_total{service="order-management",status="confirmed",version="v1"}',
    );
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
  });

  function postPayment(paymentId: string, cartId: string) {
    return http()
      .post('/internal/payments/approved')
      .set({
        'x-correlation-id': 'checkout_e2e_001',
        'x-request-id': `req_${paymentId}`,
      })
      .send({
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
      });
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
});
