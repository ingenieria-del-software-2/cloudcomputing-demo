import { DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  CreateQueueCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { TrackingEventDto } from '../src/tracking/tracking-event.dto';

type VisibleStatus =
  | 'ORDER_CONFIRMED'
  | 'FULFILLMENT_COMMITTED'
  | 'READY_TO_DISPATCH'
  | 'DISPATCH_BLOCKED'
  | 'CANCELLED';

type TrackingResponse = {
  order_id: string;
  buyer_id: string;
  visible_status: VisibleStatus;
  duplicate: boolean;
  version: string;
  timeline_length: number;
};

type TrackingRecordResponse = {
  order_id: string;
  buyer_id: string;
  visible_status: VisibleStatus;
  last_event_name: string;
  estimated_delivery_date?: string;
  timeline: Array<{
    status: VisibleStatus;
    message: string;
    event_name: string;
    correlation_id: string;
    reason?: string;
  }>;
};

type PublishedEvent = {
  event_id: string;
  event_name: string;
  event_version: string;
  producer: string;
  correlation_id: string;
  causation_id: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
};

const inputQueueUrl =
  'http://localhost:4566/000000000000/buyer-tracking-events';
const inputDlqArn =
  'arn:aws:sqs:us-east-1:000000000000:buyer-tracking-events-dlq';
const outputQueueUrl =
  'http://localhost:4566/000000000000/customer-experience-events';
const outputDlqArn =
  'arn:aws:sqs:us-east-1:000000000000:customer-experience-events-dlq';
const tableName = `buyer-visible-order-state-e2e-${Date.now()}`;

jest.setTimeout(30000);

describe('buyer-order-tracking ATDD', () => {
  let app: INestApplication<App>;
  let originalEnv: NodeJS.ProcessEnv;
  let sqs: SQSClient;
  let dynamodb: DynamoDBClient;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env = {
      ...process.env,
      AWS_ACCESS_KEY_ID: 'test',
      AWS_ENDPOINT_URL: 'http://localhost:4566',
      AWS_REGION: 'us-east-1',
      AWS_SECRET_ACCESS_KEY: 'test',
      BUYER_ORDERS_INDEX_NAME: 'buyer_id-order_id-index',
      GIT_COMMIT: 'e2e',
      INPUT_SQS_QUEUE_URL: inputQueueUrl,
      SERVICE_VERSION: 'v1',
      SQS_QUEUE_URL: outputQueueUrl,
      SQS_WAIT_TIME_SECONDS: '1',
      QUEUE_METRICS_POLL_INTERVAL_MS: '100',
      TRACKING_CONSUMER_DELAY_MS: '0',
      TRACKING_CONSUMER_ENABLED: 'true',
      TRACKING_TABLE_NAME: tableName,
      WORKER_CONCURRENCY: '1',
    };
    delete process.env.SQS_ENDPOINT;
    delete process.env.DYNAMODB_ENDPOINT;

    sqs = createSqsClient();
    dynamodb = createDynamoDbClient();
    await createQueues();

    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await dynamodb
      ?.send(new DeleteTableCommand({ TableName: tableName }))
      .catch(() => undefined);
    sqs?.destroy();
    dynamodb?.destroy();
    process.env = originalEnv;
  }, 60000);

  afterEach(() => {
    process.env.TRACKING_CONSUMER_DELAY_MS = '0';
  });

  it('exposes operational HTTP endpoints', async () => {
    await http().get('/health').expect(200, { status: 'ok' });
    await http().get('/healthz').expect(200, { status: 'ok' });
    await http()
      .get('/readyz')
      .expect(200, {
        status: 'ready',
        dependencies: {
          dynamodb: 'ready',
          sqs: 'ready',
        },
      });
    await http().get('/version').expect(200, {
      service: 'buyer-order-tracking',
      version: 'v1',
      commit: 'e2e',
    });
  });

  it('configures a DLQ redrive policy for buyer-tracking-events', async () => {
    const response = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: inputQueueUrl,
        AttributeNames: ['RedrivePolicy'],
      }),
    );

    expect(JSON.parse(response.Attributes?.RedrivePolicy ?? '{}')).toEqual({
      deadLetterTargetArn: inputDlqArn,
      maxReceiveCount: '3',
    });
  });

  it('rejects tracking events without an order id', async () => {
    const event = orderConfirmedEvent(
      `ord_track_invalid_${Date.now()}`,
      `buyer_invalid_${Date.now()}`,
    );

    await postEvent({
      ...event,
      payload: { buyer_id: event.payload.buyer_id },
    } as unknown as TrackingEventDto)
      .expect(400)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'INVALID_REQUEST',
          status: 400,
        });
      });
  });

  it('materializes a buyer-visible timeline and publishes tracking updates', async () => {
    const orderId = `ord_track_${Date.now()}`;
    const buyerId = `buyer_${Date.now()}`;

    const created = await postEvent(
      orderConfirmedEvent(orderId, buyerId),
    ).expect(202);
    expect(created.body as TrackingResponse).toMatchObject({
      order_id: orderId,
      buyer_id: buyerId,
      visible_status: 'ORDER_CONFIRMED',
      duplicate: false,
      version: 'v1',
      timeline_length: 1,
    });
    await receiveTrackingUpdate(orderId, 'ORDER_CONFIRMED');

    await postEvent(fulfillmentConfirmedEvent(orderId)).expect(202);
    await receiveTrackingUpdate(orderId, 'FULFILLMENT_COMMITTED');

    await postEvent(shipmentReadyEvent(orderId)).expect(202);
    const readyUpdate = await receiveTrackingUpdate(
      orderId,
      'READY_TO_DISPATCH',
    );
    expect(readyUpdate).toMatchObject({
      event_name: 'customer_experience.order_tracking_updated.v1',
      event_version: '1.0',
      producer: 'buyer-order-tracking',
      correlation_id: `checkout_${orderId}`,
      idempotency_key: `order_id:${orderId}:tracking`,
    });

    const tracking = await http()
      .get(`/orders/${orderId}/tracking`)
      .expect(200);
    const body = tracking.body as TrackingRecordResponse;
    expect(body).toMatchObject({
      order_id: orderId,
      buyer_id: buyerId,
      visible_status: 'READY_TO_DISPATCH',
      estimated_delivery_date: '2026-05-14',
    });
    expect(body.timeline.map((entry) => entry.status)).toEqual([
      'ORDER_CONFIRMED',
      'FULFILLMENT_COMMITTED',
      'READY_TO_DISPATCH',
    ]);
    expect(body.timeline.map((entry) => entry.message)).toEqual([
      'Tu compra fue confirmada.',
      'Estamos preparando tu compra.',
      'Tu compra esta lista para despacho.',
    ]);
    expect(
      body.timeline.every(
        (entry) => entry.correlation_id === `checkout_${orderId}`,
      ),
    ).toBe(true);

    const buyerOrders = await http()
      .get(`/buyers/${buyerId}/orders`)
      .expect(200);
    expect(buyerOrders.body).toMatchObject({
      buyer_id: buyerId,
      orders: [expect.objectContaining({ order_id: orderId })],
    });

    const metrics = await http().get('/metrics').expect(200);
    expect(metrics.text).toContain('buyer_tracking_freshness_seconds');
    expect(metrics.text).toContain(
      'buyer_tracking_freshness_under_60s_ratio{service="buyer-order-tracking",version="v1"} 1',
    );
    expect(metrics.text).toContain(
      'critical_order_journey_under_60s_ratio{service="buyer-order-tracking",version="v1"}',
    );
  });

  it('ignores duplicate tracking events without duplicating timeline entries', async () => {
    const orderId = `ord_track_duplicate_${Date.now()}`;
    const event = orderConfirmedEvent(orderId, `buyer_dup_${Date.now()}`);

    await postEvent(event).expect(202);
    await receiveTrackingUpdate(orderId, 'ORDER_CONFIRMED');
    const duplicate = await postEvent(event).expect(200);

    expect(duplicate.body as TrackingResponse).toMatchObject({
      order_id: orderId,
      visible_status: 'ORDER_CONFIRMED',
      duplicate: true,
      timeline_length: 1,
    });

    const tracking = await http()
      .get(`/orders/${orderId}/tracking`)
      .expect(200);
    expect((tracking.body as TrackingRecordResponse).timeline).toHaveLength(1);
  });

  it('keeps tracking stale while the SQS consumer is delayed', async () => {
    const orderId = `ord_track_delay_${Date.now()}`;
    const event = orderConfirmedEvent(orderId, `buyer_delay_${Date.now()}`);
    process.env.TRACKING_CONSUMER_DELAY_MS = '200';

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: inputQueueUrl,
        MessageBody: JSON.stringify(event),
      }),
    );

    await http().get(`/orders/${orderId}/tracking`).expect(404);
    await waitForTracking(orderId, 'ORDER_CONFIRMED');
    await receiveTrackingUpdate(orderId, 'ORDER_CONFIRMED');
  });

  it('shows honest buyer-facing status when dispatch is blocked', async () => {
    const orderId = `ord_track_blocked_${Date.now()}`;

    await postEvent(
      orderConfirmedEvent(orderId, `buyer_block_${Date.now()}`),
    ).expect(202);
    await receiveTrackingUpdate(orderId, 'ORDER_CONFIRMED');
    await postEvent(dispatchBlockedEvent(orderId)).expect(202);
    await receiveTrackingUpdate(orderId, 'DISPATCH_BLOCKED');

    const tracking = await http()
      .get(`/orders/${orderId}/tracking`)
      .expect(200);
    const body = tracking.body as TrackingRecordResponse;
    expect(body.visible_status).toBe('DISPATCH_BLOCKED');
    expect(body.timeline.at(-1)).toMatchObject({
      status: 'DISPATCH_BLOCKED',
      reason: 'DOCUMENT_UPLOAD_FAILED',
    });
  });

  it('shows cancelled when order-management emits order_cancelled', async () => {
    const orderId = `ord_track_cancelled_${Date.now()}`;
    const buyerId = `buyer_cancelled_${Date.now()}`;

    await postEvent(orderConfirmedEvent(orderId, buyerId)).expect(202);
    await receiveTrackingUpdate(orderId, 'ORDER_CONFIRMED');
    await postEvent(orderCancelledEvent(orderId, buyerId)).expect(202);
    await receiveTrackingUpdate(orderId, 'CANCELLED');

    const tracking = await http()
      .get(`/orders/${orderId}/tracking`)
      .expect(200);
    const body = tracking.body as TrackingRecordResponse;
    expect(body.visible_status).toBe('CANCELLED');
    expect(body.timeline.at(-1)).toMatchObject({
      status: 'CANCELLED',
      message: 'Tu compra no pudo avanzar: STOCK_UNAVAILABLE.',
      reason: 'STOCK_UNAVAILABLE',
    });
  });

  it('accepts the cancellation_requested event variant from the saga contract', async () => {
    const orderId = `ord_track_cancel_requested_${Date.now()}`;
    const buyerId = `buyer_cancel_requested_${Date.now()}`;

    await postEvent(orderConfirmedEvent(orderId, buyerId)).expect(202);
    await receiveTrackingUpdate(orderId, 'ORDER_CONFIRMED');
    await postEvent(orderCancellationRequestedEvent(orderId, buyerId)).expect(
      202,
    );
    await receiveTrackingUpdate(orderId, 'CANCELLED');

    const tracking = await http()
      .get(`/orders/${orderId}/tracking`)
      .expect(200);
    const body = tracking.body as TrackingRecordResponse;
    expect(body.visible_status).toBe('CANCELLED');
    expect(body.timeline.at(-1)).toMatchObject({
      event_name: 'orders.order_cancellation_requested.v1',
      status: 'CANCELLED',
      message: 'Tu compra no pudo avanzar: STOCK_UNAVAILABLE.',
    });
  });

  it('does not let older events downgrade the terminal tracking state', async () => {
    const orderId = `ord_track_late_${Date.now()}`;
    const buyerId = `buyer_late_${Date.now()}`;

    await postEvent(shipmentReadyEvent(orderId)).expect(202);
    await postEvent(orderConfirmedEvent(orderId, buyerId)).expect(202);

    const tracking = await http()
      .get(`/orders/${orderId}/tracking`)
      .expect(200);
    const body = tracking.body as TrackingRecordResponse;
    expect(body).toMatchObject({
      order_id: orderId,
      buyer_id: buyerId,
      visible_status: 'READY_TO_DISPATCH',
      last_event_name: 'shipping.shipment_ready_to_dispatch.v1',
    });
    expect(body.timeline.map((entry) => entry.status)).toEqual([
      'ORDER_CONFIRMED',
      'READY_TO_DISPATCH',
    ]);
  });

  it('preserves all timeline entries under concurrent event delivery', async () => {
    const orderId = `ord_track_concurrent_${Date.now()}`;
    const buyerId = `buyer_concurrent_${Date.now()}`;

    await Promise.all([
      postEvent(orderConfirmedEvent(orderId, buyerId)).expect((response) => {
        expect([200, 202]).toContain(response.status);
      }),
      postEvent(fulfillmentConfirmedEvent(orderId)).expect((response) => {
        expect([200, 202]).toContain(response.status);
      }),
      postEvent(shipmentReadyEvent(orderId)).expect((response) => {
        expect([200, 202]).toContain(response.status);
      }),
    ]);

    const body = await waitForTracking(orderId, 'READY_TO_DISPATCH');
    expect(body.timeline.map((entry) => entry.status)).toEqual([
      'ORDER_CONFIRMED',
      'FULFILLMENT_COMMITTED',
      'READY_TO_DISPATCH',
    ]);
  });

  function postEvent(event: TrackingEventDto) {
    return http()
      .post('/internal/events')
      .set({ 'x-request-id': `req_${event.event_id}` })
      .send(event);
  }

  async function waitForTracking(
    orderId: string,
    visibleStatus: VisibleStatus,
  ): Promise<TrackingRecordResponse> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await http().get(`/orders/${orderId}/tracking`);

      if (
        response.status === 200 &&
        (response.body as TrackingRecordResponse).visible_status ===
          visibleStatus
      ) {
        return response.body as TrackingRecordResponse;
      }

      await sleep(50);
    }

    throw new Error(`tracking did not reach ${visibleStatus}`);
  }

  async function receiveTrackingUpdate(
    orderId: string,
    visibleStatus: VisibleStatus,
  ): Promise<PublishedEvent> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: outputQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );

      for (const message of response.Messages ?? []) {
        const event = JSON.parse(message.Body ?? '{}') as PublishedEvent;
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: outputQueueUrl,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );

        if (
          event.payload.order_id === orderId &&
          event.payload.visible_status === visibleStatus
        ) {
          return event;
        }
      }
    }

    throw new Error(`tracking update not received for ${orderId}`);
  }

  async function createQueues(): Promise<void> {
    await sqs
      .send(new CreateQueueCommand({ QueueName: 'buyer-tracking-events-dlq' }))
      .catch(() => undefined);
    await sqs
      .send(
        new CreateQueueCommand({
          QueueName: 'buyer-tracking-events',
          Attributes: {
            RedrivePolicy: JSON.stringify({
              deadLetterTargetArn: inputDlqArn,
              maxReceiveCount: '3',
            }),
          },
        }),
      )
      .catch(() => undefined);
    await sqs
      .send(
        new CreateQueueCommand({ QueueName: 'customer-experience-events-dlq' }),
      )
      .catch(() => undefined);
    await sqs
      .send(
        new CreateQueueCommand({
          QueueName: 'customer-experience-events',
          Attributes: {
            RedrivePolicy: JSON.stringify({
              deadLetterTargetArn: outputDlqArn,
              maxReceiveCount: '3',
            }),
          },
        }),
      )
      .catch(() => undefined);
  }
});

function orderConfirmedEvent(
  orderId: string,
  buyerId: string,
): TrackingEventDto {
  const occurredAt = new Date().toISOString();

  return {
    event_id: newId('evt'),
    event_name: 'orders.order_confirmed.v1',
    event_version: '1.0',
    occurred_at: occurredAt,
    producer: 'order-management',
    correlation_id: `checkout_${orderId}`,
    causation_id: `pay_${orderId}`,
    idempotency_key: `payment_id:pay_${orderId}`,
    payload: {
      order_id: orderId,
      payment_id: `pay_${orderId}`,
      buyer_id: buyerId,
      seller_id: 'seller_445566',
      site_id: 'MLA',
      currency: 'ARS',
      gross_amount: 52999.99,
      payment_approved_at: occurredAt,
      items: [
        {
          item_id: 'MLA123456789',
          seller_sku: 'NIKE-AIR-BLK-42',
          quantity: 1,
          unit_price: 52999.99,
        },
      ],
      confirmed_at: occurredAt,
    },
  };
}

function fulfillmentConfirmedEvent(orderId: string): TrackingEventDto {
  const occurredAt = new Date(Date.now() + 1000).toISOString();

  return {
    event_id: newId('evt'),
    event_name: 'fulfillment.commitment_confirmed.v1',
    event_version: '1.0',
    occurred_at: occurredAt,
    producer: 'fulfillment-planning',
    correlation_id: `checkout_${orderId}`,
    causation_id: `evt_order_${orderId}`,
    idempotency_key: `order_id:${orderId}`,
    payload: {
      order_id: orderId,
      fulfillment_commitment_id: `fc_${orderId}`,
      seller_id: 'seller_445566',
      fulfillment_model: 'seller_flex',
      origin_type: 'seller_location',
      estimated_delivery_date: '2026-05-14',
      payment_approved_at: new Date(Date.now() - 1000).toISOString(),
      reserved_items: [
        {
          seller_sku: 'NIKE-AIR-BLK-42',
          quantity: 1,
          reservation_id: `res_${orderId}`,
        },
      ],
      committed_at: occurredAt,
    },
  };
}

function shipmentReadyEvent(orderId: string): TrackingEventDto {
  const occurredAt = new Date(Date.now() + 2000).toISOString();

  return {
    event_id: newId('evt'),
    event_name: 'shipping.shipment_ready_to_dispatch.v1',
    event_version: '1.0',
    occurred_at: occurredAt,
    producer: 'shipment-preparation',
    correlation_id: `checkout_${orderId}`,
    causation_id: `evt_fulfillment_${orderId}`,
    idempotency_key: `order_id:${orderId}`,
    payload: {
      order_id: orderId,
      shipment_id: `shp_${orderId}`,
      seller_id: 'seller_445566',
      label_status: 'AVAILABLE',
      documents: [
        {
          type: 'SHIPPING_LABEL',
          bucket: 'seller-dispatch-documents-lab',
          key: `shipments/shp_${orderId}/labels/shipping-label.pdf`,
        },
      ],
      seller_cutoff_at: '2026-05-12T18:00:00-03:00',
      payment_approved_at: new Date(Date.now() - 2000).toISOString(),
      ready_to_dispatch_at: occurredAt,
    },
  };
}

function dispatchBlockedEvent(orderId: string): TrackingEventDto {
  const occurredAt = new Date(Date.now() + 1000).toISOString();

  return {
    event_id: newId('evt'),
    event_name: 'shipping.dispatch_blocked.v1',
    event_version: '1.0',
    occurred_at: occurredAt,
    producer: 'shipment-preparation',
    correlation_id: `checkout_${orderId}`,
    causation_id: `evt_fulfillment_${orderId}`,
    idempotency_key: `order_id:${orderId}`,
    payload: {
      order_id: orderId,
      shipment_id: `shp_${orderId}`,
      seller_id: 'seller_445566',
      reason: 'DOCUMENT_UPLOAD_FAILED',
      seller_cutoff_at: '2026-05-12T18:00:00-03:00',
      blocked_at: occurredAt,
    },
  };
}

function orderCancelledEvent(
  orderId: string,
  buyerId: string,
): TrackingEventDto {
  const occurredAt = new Date(Date.now() + 1000).toISOString();

  return {
    event_id: newId('evt'),
    event_name: 'orders.order_cancelled.v1',
    event_version: '1.0',
    occurred_at: occurredAt,
    producer: 'order-management',
    correlation_id: `checkout_${orderId}`,
    causation_id: `evt_fulfillment_failed_${orderId}`,
    idempotency_key: `order_id:${orderId}:cancellation`,
    payload: {
      order_id: orderId,
      payment_id: `pay_${orderId}`,
      buyer_id: buyerId,
      seller_id: 'seller_445566',
      reason: 'STOCK_UNAVAILABLE',
      payment_approved_at: new Date(Date.now() - 1000).toISOString(),
      cancelled_at: occurredAt,
    },
  };
}

function orderCancellationRequestedEvent(
  orderId: string,
  buyerId: string,
): TrackingEventDto {
  const occurredAt = new Date(Date.now() + 1000).toISOString();

  return {
    event_id: newId('evt'),
    event_name: 'orders.order_cancellation_requested.v1',
    event_version: '1.0',
    occurred_at: occurredAt,
    producer: 'order-management',
    correlation_id: `checkout_${orderId}`,
    causation_id: `evt_fulfillment_failed_${orderId}`,
    idempotency_key: `order_id:${orderId}:cancellation-request`,
    payload: {
      order_id: orderId,
      payment_id: `pay_${orderId}`,
      buyer_id: buyerId,
      seller_id: 'seller_445566',
      reason: 'STOCK_UNAVAILABLE',
      payment_approved_at: new Date(Date.now() - 1000).toISOString(),
      cancellation_requested_at: occurredAt,
    },
  };
}

function createSqsClient(): SQSClient {
  return new SQSClient({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
}

function createDynamoDbClient(): DynamoDBClient {
  return new DynamoDBClient({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
