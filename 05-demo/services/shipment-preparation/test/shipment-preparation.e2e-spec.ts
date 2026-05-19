import {
  CreateBucketCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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
import { Pool } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { FulfillmentCommitmentEventDto } from '../src/shipment/fulfillment-commitment-event.dto';

type ShipmentStatus = 'READY_TO_DISPATCH' | 'DISPATCH_BLOCKED';
type DocumentType = 'SHIPPING_LABEL' | 'DISPATCH_INSTRUCTIONS';

type ShipmentDocumentResponse = {
  document_type: DocumentType;
  s3_bucket: string;
  s3_key: string;
  status: string;
};

type ShipmentResponse = {
  shipment_id: string;
  order_id: string;
  status: ShipmentStatus;
  duplicate: boolean;
  version: string;
  reason?: string;
};

type ShippingEventEnvelope = {
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
  'http://localhost:4566/000000000000/fulfillment-commitment-intake';
const inputDlqArn =
  'arn:aws:sqs:us-east-1:000000000000:fulfillment-commitment-dlq';
const outputQueueUrl =
  'http://localhost:4566/000000000000/buyer-tracking-events';
const outputDlqArn =
  'arn:aws:sqs:us-east-1:000000000000:buyer-tracking-events-dlq';
const bucketName = 'seller-dispatch-documents-lab';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://shipment:shipment@localhost:15434/shipment_preparation';

jest.setTimeout(30000);

describe('shipment-preparation ATDD', () => {
  let app: INestApplication<App>;
  let originalEnv: NodeJS.ProcessEnv;
  let sqs: SQSClient;
  let s3: S3Client;
  let db: Pool;
  const bufferedEvents: ShippingEventEnvelope[] = [];

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
      S3_BAD_KEY_ENABLED: 'false',
      S3_PUT_OBJECT_ALLOWED: 'true',
      S3_TRANSIENT_FAILURES_BEFORE_SUCCESS: '0',
      S3_UPLOAD_MAX_ATTEMPTS: '2',
      S3_UPLOAD_RETRY_DELAY_MS: '0',
      SELLER_CUTOFF_EXPIRED: 'false',
      SERVICE_VERSION: 'v1',
      SHIPMENT_DOCUMENTS_BUCKET: bucketName,
      SQS_QUEUE_URL: outputQueueUrl,
      SQS_WAIT_TIME_SECONDS: '1',
      WORKER_CONCURRENCY: '1',
      WORKER_ENABLED: 'true',
    };
    delete process.env.SQS_ENDPOINT;
    delete process.env.S3_ENDPOINT;

    sqs = createSqsClient();
    s3 = createS3Client();
    db = new Pool({ connectionString: databaseUrl });
    await createQueues();
    await s3
      .send(new CreateBucketCommand({ Bucket: bucketName }))
      .catch(() => undefined);

    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await db?.end();
    sqs?.destroy();
    s3?.destroy();
    process.env = originalEnv;
  }, 60000);

  afterEach(() => {
    process.env.S3_BAD_KEY_ENABLED = 'false';
    process.env.S3_PUT_OBJECT_ALLOWED = 'true';
    process.env.S3_TRANSIENT_FAILURES_BEFORE_SUCCESS = '0';
    process.env.S3_UPLOAD_MAX_ATTEMPTS = '2';
    process.env.S3_UPLOAD_RETRY_DELAY_MS = '0';
    process.env.SELLER_CUTOFF_EXPIRED = 'false';
    bufferedEvents.length = 0;
  });

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
          s3: 'ready',
        },
      });
    await http().get('/version').expect(200, {
      service: 'shipment-preparation',
      version: 'v1',
      commit: 'e2e',
    });
  });

  it('configures a DLQ redrive policy for buyer-tracking-events', async () => {
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

  it('creates a shipment, uploads the label to S3, and publishes ready_to_dispatch', async () => {
    const orderId = `ord_ship_${Date.now()}`;

    const created = await postCommitment(orderId).expect(202);
    const shipment = created.body as ShipmentResponse;

    expect(shipment).toMatchObject({
      order_id: orderId,
      status: 'READY_TO_DISPATCH',
      duplicate: false,
      version: 'v1',
    });
    expect(shipment.shipment_id).toMatch(/^shp_/);

    await http()
      .get(`/shipments/${shipment.shipment_id}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as {
          shipment_id: string;
          order_id: string;
          status: ShipmentStatus;
        };
        expect(body).toMatchObject({
          shipment_id: shipment.shipment_id,
          order_id: orderId,
          status: 'READY_TO_DISPATCH',
        });
      });

    const documents = await http()
      .get(`/shipments/${shipment.shipment_id}/documents`)
      .expect(200);
    const shipmentDocuments = (
      documents.body as { documents: ShipmentDocumentResponse[] }
    ).documents;
    const label = requireDocument(shipmentDocuments, 'SHIPPING_LABEL');
    const instructions = requireDocument(
      shipmentDocuments,
      'DISPATCH_INSTRUCTIONS',
    );
    expect(label).toMatchObject({
      s3_bucket: bucketName,
      s3_key: `shipments/${shipment.shipment_id}/labels/shipping-label.pdf`,
      status: 'AVAILABLE',
    });
    expect(instructions).toMatchObject({
      s3_bucket: bucketName,
      s3_key: `shipments/${shipment.shipment_id}/instructions/dispatch-instructions.json`,
      status: 'AVAILABLE',
    });

    await expect(headObject(label.s3_key)).resolves.toBe(true);
    await expect(headObject(instructions.s3_key)).resolves.toBe(true);

    const documentsEvent = await receiveEvent(
      'shipping.dispatch_document_available.v1',
      orderId,
    );
    expect(documentsEvent).toMatchObject({
      event_name: 'shipping.dispatch_document_available.v1',
      event_version: '1.0',
      producer: 'shipment-preparation',
      correlation_id: `checkout_${orderId}`,
      idempotency_key: `order_id:${orderId}:documents`,
    });
    expect(documentsEvent.payload.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'SHIPPING_LABEL',
          status: 'AVAILABLE',
        }),
        expect.objectContaining({
          type: 'DISPATCH_INSTRUCTIONS',
          status: 'AVAILABLE',
        }),
      ]),
    );

    const event = await receiveEvent(
      'shipping.shipment_ready_to_dispatch.v1',
      orderId,
    );
    expect(event).toMatchObject({
      event_name: 'shipping.shipment_ready_to_dispatch.v1',
      event_version: '1.0',
      producer: 'shipment-preparation',
      correlation_id: `checkout_${orderId}`,
      idempotency_key: `order_id:${orderId}`,
    });
    expect(event.event_id).toMatch(/^evt_/);
    expect(event.payload).toMatchObject({
      order_id: orderId,
      shipment_id: shipment.shipment_id,
      seller_id: 'seller_445566',
      label_status: 'AVAILABLE',
    });

    const metrics = await http().get('/metrics').expect(200);
    expect(metrics.text).toContain(
      'shipments_total{service="shipment-preparation",status="ready_to_dispatch",version="v1"}',
    );
    expect(metrics.text).toContain(
      'ready_to_dispatch_before_seller_cutoff_ratio{service="shipment-preparation",version="v1"} 1',
    );
    expect(metrics.text).toContain(
      'dispatch_document_availability_on_first_access_ratio{service="shipment-preparation",version="v1"} 1',
    );
  });

  it('retries transient S3 upload failures before marking a shipment ready', async () => {
    const orderId = `ord_ship_retry_${Date.now()}`;
    process.env.S3_TRANSIENT_FAILURES_BEFORE_SUCCESS = '1';
    process.env.S3_UPLOAD_MAX_ATTEMPTS = '2';

    const created = await postCommitment(orderId).expect(202);
    const shipment = created.body as ShipmentResponse;

    expect(shipment).toMatchObject({
      order_id: orderId,
      status: 'READY_TO_DISPATCH',
      duplicate: false,
    });
    const documents = await http()
      .get(`/shipments/${shipment.shipment_id}/documents`)
      .expect(200);
    const shipmentDocuments = (
      documents.body as { documents: ShipmentDocumentResponse[] }
    ).documents;

    await expect(
      headObject(requireDocument(shipmentDocuments, 'SHIPPING_LABEL').s3_key),
    ).resolves.toBe(true);
    await expect(
      headObject(
        requireDocument(shipmentDocuments, 'DISPATCH_INSTRUCTIONS').s3_key,
      ),
    ).resolves.toBe(true);
    await receiveEvent('shipping.shipment_ready_to_dispatch.v1', orderId);
  });

  it('ignores duplicate fulfillment commitment events without duplicating shipment documents', async () => {
    const orderId = `ord_ship_duplicate_${Date.now()}`;
    const event = commitmentEvent(orderId);

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
      shipment_id: (first.body as ShipmentResponse).shipment_id,
      status: 'READY_TO_DISPATCH',
      duplicate: true,
    });
    await expect(dbShipmentCount(orderId)).resolves.toBe(1);
    await expect(
      dbDocumentCount((first.body as ShipmentResponse).shipment_id),
    ).resolves.toBe(2);

    await receiveEvent('shipping.shipment_ready_to_dispatch.v1', orderId);
  });

  it('publishes dispatch_blocked when document upload is denied', async () => {
    const orderId = `ord_ship_denied_${Date.now()}`;
    process.env.S3_PUT_OBJECT_ALLOWED = 'false';

    const created = await postCommitment(orderId).expect(202);
    const shipment = created.body as ShipmentResponse;

    expect(shipment).toMatchObject({
      order_id: orderId,
      status: 'DISPATCH_BLOCKED',
      duplicate: false,
      reason: 'DOCUMENT_UPLOAD_ACCESS_DENIED',
    });

    const documents = await http()
      .get(`/shipments/${shipment.shipment_id}/documents`)
      .expect(200);
    const blockedDocuments = (
      documents.body as { documents: ShipmentDocumentResponse[] }
    ).documents;
    expect(blockedDocuments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          s3_bucket: bucketName,
          s3_key: `shipments/${shipment.shipment_id}/labels/shipping-label.pdf`,
          status: 'UPLOAD_FAILED',
        }),
        expect.objectContaining({
          s3_bucket: bucketName,
          s3_key: `shipments/${shipment.shipment_id}/instructions/dispatch-instructions.json`,
          status: 'UPLOAD_FAILED',
        }),
      ]),
    );

    const event = await receiveEvent('shipping.dispatch_blocked.v1', orderId);
    expect(event).toMatchObject({
      event_name: 'shipping.dispatch_blocked.v1',
      producer: 'shipment-preparation',
      correlation_id: `checkout_${orderId}`,
      idempotency_key: `order_id:${orderId}`,
    });
    expect(event.payload).toMatchObject({
      order_id: orderId,
      shipment_id: shipment.shipment_id,
      reason: 'DOCUMENT_UPLOAD_ACCESS_DENIED',
    });

    const metrics = await http().get('/metrics').expect(200);
    expect(metrics.text).toContain(
      'shipment_document_failures_total{service="shipment-preparation",version="v1"} 1',
    );
    expect(metrics.text).toContain(
      'dispatch_document_failure_count{service="shipment-preparation",version="v1"} 1',
    );
    expect(metrics.text).toContain(
      'dispatch_document_availability_on_first_access_ratio{service="shipment-preparation",version="v1"} 0',
    );
  });

  it('blocks dispatch when generated S3 document keys are invalid', async () => {
    const orderId = `ord_ship_bad_key_${Date.now()}`;
    process.env.S3_BAD_KEY_ENABLED = 'true';

    const created = await postCommitment(orderId).expect(202);
    const shipment = created.body as ShipmentResponse;

    expect(shipment).toMatchObject({
      order_id: orderId,
      status: 'DISPATCH_BLOCKED',
      duplicate: false,
      reason: 'DOCUMENT_KEY_INVALID',
    });

    const documents = await http()
      .get(`/shipments/${shipment.shipment_id}/documents`)
      .expect(200);
    const shipmentDocuments = (
      documents.body as { documents: ShipmentDocumentResponse[] }
    ).documents;
    expect(shipmentDocuments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          s3_key: `bad-key/${shipment.shipment_id}/labels/shipping-label.pdf`,
          status: 'UPLOAD_FAILED',
        }),
        expect.objectContaining({
          s3_key: `bad-key/${shipment.shipment_id}/instructions/dispatch-instructions.json`,
          status: 'UPLOAD_FAILED',
        }),
      ]),
    );
    await expect(
      headObject(`shipments/${shipment.shipment_id}/labels/shipping-label.pdf`),
    ).resolves.toBe(false);

    const event = await receiveEvent('shipping.dispatch_blocked.v1', orderId);
    expect(event.payload).toMatchObject({
      order_id: orderId,
      shipment_id: shipment.shipment_id,
      reason: 'DOCUMENT_KEY_INVALID',
    });
  });

  it('marks shipment as blocked when seller cutoff is already expired', async () => {
    const orderId = `ord_ship_cutoff_${Date.now()}`;
    process.env.SELLER_CUTOFF_EXPIRED = 'true';

    const created = await postCommitment(orderId).expect(202);
    const shipment = created.body as ShipmentResponse;

    expect(shipment).toMatchObject({
      order_id: orderId,
      status: 'DISPATCH_BLOCKED',
      duplicate: false,
      reason: 'SELLER_CUTOFF_EXPIRED',
    });

    const documents = await http()
      .get(`/shipments/${shipment.shipment_id}/documents`)
      .expect(200);
    const shipmentDocuments = (
      documents.body as { documents: ShipmentDocumentResponse[] }
    ).documents;
    expect(shipmentDocuments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'AVAILABLE' }),
        expect.objectContaining({ status: 'AVAILABLE' }),
      ]),
    );

    const event = await receiveEvent('shipping.dispatch_blocked.v1', orderId);
    expect(event.payload).toMatchObject({
      order_id: orderId,
      shipment_id: shipment.shipment_id,
      reason: 'SELLER_CUTOFF_EXPIRED',
    });
    const metrics = await http().get('/metrics').expect(200);
    expect(metrics.text).toContain(
      'ready_to_dispatch_before_seller_cutoff_ratio{service="shipment-preparation",version="v1"} 0',
    );
  });

  it('consumes fulfillment commitments from SQS and publishes ready_to_dispatch', async () => {
    const orderId = `ord_ship_worker_${Date.now()}`;
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: inputQueueUrl,
        MessageBody: JSON.stringify(commitmentEvent(orderId)),
      }),
    );

    const event = await receiveEvent(
      'shipping.shipment_ready_to_dispatch.v1',
      orderId,
    );
    expect(event.payload.order_id).toBe(orderId);
    await expect(dbShipmentStatus(orderId)).resolves.toBe('READY_TO_DISPATCH');
  });

  function postCommitment(orderId: string) {
    return http()
      .post('/internal/events')
      .set({ 'x-request-id': `req_${orderId}` })
      .send(commitmentEvent(orderId));
  }

  async function receiveEvent(
    eventName: string,
    orderId: string,
  ): Promise<ShippingEventEnvelope> {
    const deadline = Date.now() + 5000;
    const seen: string[] = [];
    const buffered = takeBufferedEvent(bufferedEvents, eventName, orderId);

    if (buffered) {
      return buffered;
    }

    while (Date.now() < deadline) {
      let matched: ShippingEventEnvelope | undefined;
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: outputQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );

      for (const message of response.Messages ?? []) {
        const event = message.Body
          ? (JSON.parse(message.Body) as ShippingEventEnvelope)
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
          matched = event;
          continue;
        }

        if (event) {
          bufferedEvents.push(event);
        }

        if (event?.event_name) {
          seen.push(`${event.event_name}:${String(event.payload.order_id)}`);
        }
      }

      if (matched) {
        return matched;
      }
    }

    throw new Error(
      `${eventName} not found for ${orderId}; seen=${seen.join(',')}`,
    );
  }

  async function headObject(key: string): Promise<boolean> {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  function requireDocument(
    documents: ShipmentDocumentResponse[],
    documentType: DocumentType,
  ): ShipmentDocumentResponse {
    const document = documents.find(
      (candidate) => candidate.document_type === documentType,
    );

    if (!document) {
      throw new Error(`${documentType} document not found`);
    }

    return document;
  }

  async function dbShipmentCount(orderId: string): Promise<number> {
    const result = await db.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM shipments WHERE order_id = $1',
      [orderId],
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async function dbDocumentCount(shipmentId: string): Promise<number> {
    const result = await db.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM dispatch_documents WHERE shipment_id = $1',
      [shipmentId],
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async function dbShipmentStatus(
    orderId: string,
  ): Promise<string | undefined> {
    const result = await db.query<{ status: string }>(
      'SELECT status FROM shipments WHERE order_id = $1',
      [orderId],
    );

    return result.rows[0]?.status;
  }

  async function createQueues(): Promise<void> {
    await sqs.send(
      new CreateQueueCommand({ QueueName: 'fulfillment-commitment-dlq' }),
    );
    await sqs.send(
      new CreateQueueCommand({
        QueueName: 'fulfillment-commitment-intake',
        Attributes: {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: inputDlqArn,
            maxReceiveCount: '3',
          }),
        },
      }),
    );
    await sqs.send(
      new CreateQueueCommand({ QueueName: 'buyer-tracking-events-dlq' }),
    );
    await sqs.send(
      new CreateQueueCommand({
        QueueName: 'buyer-tracking-events',
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

function commitmentEvent(orderId: string): FulfillmentCommitmentEventDto {
  const occurredAt = new Date().toISOString();

  return {
    event_id: `evt_${orderId}`,
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
      fulfillment_model: 'standard',
      origin_type: 'seller_location',
      estimated_delivery_date: '2026-05-14',
      reserved_items: [
        {
          seller_sku: 'CARPINCHO-USB-C',
          quantity: 1,
          reservation_id: `res_${orderId}`,
        },
      ],
      committed_at: occurredAt,
    },
  };
}

function takeBufferedEvent(
  events: ShippingEventEnvelope[],
  eventName: string,
  orderId: string,
): ShippingEventEnvelope | undefined {
  const index = events.findIndex(
    (event) =>
      event.event_name === eventName && event.payload.order_id === orderId,
  );

  if (index === -1) {
    return undefined;
  }

  return events.splice(index, 1)[0];
}

function createSqsClient(): SQSClient {
  return new SQSClient({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test',
    },
  });
}

function createS3Client(): S3Client {
  return new S3Client({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
    forcePathStyle: true,
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test',
    },
  });
}
