import {
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import { MetricsService } from '../metrics/metrics.service';
import { FulfillmentCommitmentEventDto } from './fulfillment-commitment-event.dto';

type ShipmentStatus = 'READY_TO_DISPATCH' | 'DISPATCH_BLOCKED';
type DocumentStatus = 'AVAILABLE' | 'UPLOAD_FAILED';
type DocumentType = 'SHIPPING_LABEL' | 'DISPATCH_INSTRUCTIONS';

interface EventEnvelope<TPayload> {
  event_id: string;
  event_name: string;
  event_version: '1.0';
  occurred_at: string;
  producer: 'shipment-preparation';
  correlation_id: string;
  causation_id: string;
  idempotency_key: string;
  payload: TPayload;
}

interface HandleCommitmentCommand {
  event: FulfillmentCommitmentEventDto;
  requestId: string;
}

export interface DispatchDocumentRecord {
  document_id: string;
  shipment_id: string;
  document_type: DocumentType;
  s3_bucket: string;
  s3_key: string;
  status: DocumentStatus;
  created_at: string;
}

export interface ShipmentRecord {
  shipment_id: string;
  order_id: string;
  fulfillment_commitment_id: string;
  seller_id: string;
  status: ShipmentStatus;
  seller_cutoff_at: string;
  ready_to_dispatch_at?: string;
  block_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface ShipmentAcceptedResponse {
  shipment_id: string;
  order_id: string;
  status: ShipmentStatus;
  duplicate: boolean;
  version: string;
  reason?: string;
}

interface ShipmentCreateResult {
  shipment: ShipmentRecord;
  documents: DispatchDocumentRecord[];
  duplicate: boolean;
  documentUploadFailed: boolean;
}

interface ShipmentRow extends QueryResultRow {
  shipment_id: string;
  order_id: string;
  fulfillment_commitment_id: string;
  seller_id: string;
  status: ShipmentStatus;
  seller_cutoff_at: Date | string;
  ready_to_dispatch_at?: Date | string;
  block_reason?: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DocumentRow extends QueryResultRow {
  document_id: string;
  shipment_id: string;
  document_type: DocumentType;
  s3_bucket: string;
  s3_key: string;
  status: DocumentStatus;
  created_at: Date | string;
}

interface PlannedDocument {
  documentId: string;
  documentType: DocumentType;
  bucket: string;
  key: string;
  body: string;
  contentType: string;
}

type UploadResult = { ok: true } | { ok: false; reason: string };

@Injectable()
export class ShipmentService implements OnModuleInit, OnModuleDestroy {
  private pool?: Pool;
  private sqsClient?: SQSClient;
  private s3Client?: S3Client;
  private stopping = false;
  private workers: Promise<void>[] = [];
  private readonly transientFailuresByKey = new Map<string, number>();

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
    this.startWorkers();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.sqsClient?.destroy();
    this.s3Client?.destroy();
    await Promise.allSettled(this.workers);
    await this.pool?.end();
  }

  async handleCommitmentConfirmed(
    command: HandleCommitmentCommand,
  ): Promise<ShipmentAcceptedResponse> {
    const startedAt = performance.now();
    const version = this.config.get<string>('SERVICE_VERSION', 'v1');

    try {
      const result = await this.createOrReplayShipment(command.event);

      if (result.duplicate) {
        return this.acceptDuplicate(
          command,
          result.shipment,
          version,
          startedAt,
        );
      }

      await this.publishOutcome(command, result, version, startedAt);
      return response(result.shipment, false, version);
    } catch (error) {
      this.metrics.recordShipment('processing_failed', version);
      this.metrics.observeShipmentDuration(
        'processing_failed',
        version,
        durationSeconds(startedAt),
      );
      this.logger.error('shipment_processing_failed', {
        request_id: command.requestId,
        event_id: command.event.event_id,
        event_name: command.event.event_name,
        correlation_id: command.event.correlation_id,
        order_id: command.event.payload.order_id,
        status_before: 'FULFILLMENT_COMMITTED',
        status_after: 'DISPATCH_BLOCKED',
        business_error_code: processingFailureCode(error),
        duration_ms: durationMs(startedAt),
        result: 'SHIPMENT_PROCESSING_FAILED',
        error_message: error instanceof Error ? error.message : 'unknown error',
      });
      throw new ServiceUnavailableException({
        status: 503,
        code: 'SHIPMENT_PREPARATION_FAILED',
        message: 'Shipment could not be prepared',
      });
    }
  }

  async findShipmentById(
    shipmentId: string,
  ): Promise<ShipmentRecord | undefined> {
    const result = await this.db().query<ShipmentRow>(
      `SELECT shipment_id, order_id, fulfillment_commitment_id, seller_id, status,
              seller_cutoff_at, ready_to_dispatch_at, block_reason, created_at, updated_at
       FROM shipments
       WHERE shipment_id = $1`,
      [shipmentId],
    );

    return result.rows[0] ? toShipment(result.rows[0]) : undefined;
  }

  async findDocumentsByShipmentId(
    shipmentId: string,
  ): Promise<DispatchDocumentRecord[]> {
    const result = await this.db().query<DocumentRow>(
      `SELECT document_id, shipment_id, document_type, s3_bucket, s3_key, status, created_at
       FROM dispatch_documents
       WHERE shipment_id = $1
       ORDER BY created_at ASC, document_type ASC`,
      [shipmentId],
    );

    return result.rows.map(toDocument);
  }

  async checkBucketReady(): Promise<boolean> {
    try {
      await this.s3().send(
        new HeadBucketCommand({ Bucket: this.bucketName() }),
      );
      return true;
    } catch {
      return false;
    }
  }

  recordDocumentAccess(documents: DispatchDocumentRecord[]): void {
    const version = this.config.get<string>('SERVICE_VERSION', 'v1');
    this.metrics.recordDocumentAvailabilityOnAccess(
      version,
      documents.length > 0 &&
        documents.every((document) => document.status === 'AVAILABLE'),
    );
  }

  private async createOrReplayShipment(
    event: FulfillmentCommitmentEventDto,
  ): Promise<ShipmentCreateResult> {
    const client = await this.db().connect();

    try {
      await client.query('BEGIN');

      const existing = await this.findShipmentByOrderIdForUpdate(
        client,
        event.payload.order_id,
      );
      if (existing) {
        const documents = await this.findDocumentsByShipmentId(
          existing.shipment_id,
        );
        await client.query('COMMIT');
        return {
          shipment: existing,
          documents,
          duplicate: true,
          documentUploadFailed: false,
        };
      }

      const now = new Date().toISOString();
      const shipmentId = newId('shp');
      const plannedDocuments = this.dispatchDocuments(shipmentId, event);
      const uploadResults = await this.uploadDocuments(plannedDocuments);
      const uploadSucceeded = uploadResults.every((result) => result.ok);
      const sellerCutoff = this.sellerCutoffAt();
      const cutoffExpired =
        uploadSucceeded && isCutoffExpired(sellerCutoff, now);
      const status: ShipmentStatus =
        uploadSucceeded && !cutoffExpired
          ? 'READY_TO_DISPATCH'
          : 'DISPATCH_BLOCKED';
      const shipment = await this.insertShipment(client, {
        shipmentId,
        orderId: event.payload.order_id,
        fulfillmentCommitmentId: event.payload.fulfillment_commitment_id,
        sellerId: event.payload.seller_id,
        status,
        sellerCutoffAt: sellerCutoff,
        readyToDispatchAt: status === 'READY_TO_DISPATCH' ? now : undefined,
        blockReason: blockReason(uploadSucceeded, cutoffExpired, uploadResults),
        createdAt: now,
      });
      const documents: DispatchDocumentRecord[] = [];
      for (const [index, document] of plannedDocuments.entries()) {
        documents.push(
          await this.insertDocument(client, {
            shipmentId,
            documentId: document.documentId,
            documentType: document.documentType,
            bucket: document.bucket,
            key: document.key,
            status: uploadResults[index]?.ok ? 'AVAILABLE' : 'UPLOAD_FAILED',
            createdAt: now,
          }),
        );
      }

      await client.query('COMMIT');

      return {
        shipment,
        documents,
        duplicate: false,
        documentUploadFailed: !uploadSucceeded,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);

      if (isPgUniqueViolation(error)) {
        const existing = await this.findShipmentByOrderId(
          event.payload.order_id,
        );
        if (existing) {
          return {
            shipment: existing,
            documents: await this.findDocumentsByShipmentId(
              existing.shipment_id,
            ),
            duplicate: true,
            documentUploadFailed: false,
          };
        }
      }

      throw error;
    } finally {
      client.release();
    }
  }

  private async findShipmentByOrderId(
    orderId: string,
  ): Promise<ShipmentRecord | undefined> {
    const result = await this.db().query<ShipmentRow>(
      `${shipmentSelectSql()} WHERE order_id = $1`,
      [orderId],
    );

    return result.rows[0] ? toShipment(result.rows[0]) : undefined;
  }

  private async findShipmentByOrderIdForUpdate(
    client: PoolClient,
    orderId: string,
  ): Promise<ShipmentRecord | undefined> {
    const result = await client.query<ShipmentRow>(
      `${shipmentSelectSql()} WHERE order_id = $1 FOR UPDATE`,
      [orderId],
    );

    return result.rows[0] ? toShipment(result.rows[0]) : undefined;
  }

  private async insertShipment(
    client: PoolClient,
    input: {
      shipmentId: string;
      orderId: string;
      fulfillmentCommitmentId: string;
      sellerId: string;
      status: ShipmentStatus;
      sellerCutoffAt: string;
      readyToDispatchAt?: string;
      blockReason?: string;
      createdAt: string;
    },
  ): Promise<ShipmentRecord> {
    const result = await client.query<ShipmentRow>(
      `INSERT INTO shipments (
         shipment_id, order_id, fulfillment_commitment_id, seller_id, status,
         seller_cutoff_at, ready_to_dispatch_at, block_reason, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING shipment_id, order_id, fulfillment_commitment_id, seller_id, status,
                 seller_cutoff_at, ready_to_dispatch_at, block_reason, created_at, updated_at`,
      [
        input.shipmentId,
        input.orderId,
        input.fulfillmentCommitmentId,
        input.sellerId,
        input.status,
        input.sellerCutoffAt,
        input.readyToDispatchAt,
        input.blockReason,
        input.createdAt,
      ],
    );

    return toShipment(result.rows[0]);
  }

  private async insertDocument(
    client: PoolClient,
    input: {
      shipmentId: string;
      documentId: string;
      documentType: DocumentType;
      bucket: string;
      key: string;
      status: DocumentStatus;
      createdAt: string;
    },
  ): Promise<DispatchDocumentRecord> {
    const result = await client.query<DocumentRow>(
      `INSERT INTO dispatch_documents (
         document_id, shipment_id, document_type, s3_bucket, s3_key, status, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING document_id, shipment_id, document_type, s3_bucket, s3_key, status, created_at`,
      [
        input.documentId,
        input.shipmentId,
        input.documentType,
        input.bucket,
        input.key,
        input.status,
        input.createdAt,
      ],
    );

    return toDocument(result.rows[0]);
  }

  private dispatchDocuments(
    shipmentId: string,
    event: FulfillmentCommitmentEventDto,
  ): PlannedDocument[] {
    const generatedAt = new Date().toISOString();
    const keyPrefix = this.s3BadKeyEnabled()
      ? `bad-key/${shipmentId}`
      : `shipments/${shipmentId}`;

    return [
      {
        documentId: newId('doc'),
        documentType: 'SHIPPING_LABEL',
        bucket: this.bucketName(),
        key: `${keyPrefix}/labels/shipping-label.pdf`,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'SHIPPING_LABEL',
          shipment_id: shipmentId,
          order_id: event.payload.order_id,
          seller_id: event.payload.seller_id,
          fulfillment_commitment_id: event.payload.fulfillment_commitment_id,
          generated_at: generatedAt,
        }),
      },
      {
        documentId: newId('doc'),
        documentType: 'DISPATCH_INSTRUCTIONS',
        bucket: this.bucketName(),
        key: `${keyPrefix}/instructions/dispatch-instructions.json`,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'DISPATCH_INSTRUCTIONS',
          shipment_id: shipmentId,
          order_id: event.payload.order_id,
          seller_id: event.payload.seller_id,
          origin_type: event.payload.origin_type,
          reserved_items: event.payload.reserved_items,
          generated_at: generatedAt,
        }),
      },
    ];
  }

  private async uploadDocuments(
    documents: PlannedDocument[],
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = [];

    for (const document of documents) {
      results.push(await this.uploadDocument(document));
    }

    return results;
  }

  private async uploadDocument(
    document: PlannedDocument,
  ): Promise<UploadResult> {
    if (!this.s3PutObjectAllowed()) {
      this.logger.error('s3_put_object_access_denied', {
        s3_bucket: document.bucket,
        s3_key: document.key,
        error_type: 'AccessDenied',
        business_error_code: 'DOCUMENT_UPLOAD_ACCESS_DENIED',
        result: 'AccessDenied',
        error_message: 'AccessDenied: s3:PutObject is not allowed',
      });
      return { ok: false, reason: 'DOCUMENT_UPLOAD_ACCESS_DENIED' };
    }

    if (!isValidDocumentKey(document.key)) {
      this.logger.error('s3_document_key_invalid', {
        s3_bucket: document.bucket,
        s3_key: document.key,
        business_error_code: 'DOCUMENT_KEY_INVALID',
        result: 'DOCUMENT_KEY_INVALID',
        error_message:
          'Generated S3 key does not match shipment document prefix',
      });
      return { ok: false, reason: 'DOCUMENT_KEY_INVALID' };
    }

    const maxAttempts = this.s3UploadMaxAttempts();
    let lastReason = 'DOCUMENT_UPLOAD_FAILED';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.putObject(document);
        return { ok: true };
      } catch (error) {
        lastReason = s3FailureCode(error);
        this.logS3UploadFailure(
          document,
          error,
          attempt,
          maxAttempts,
          lastReason,
        );

        if (
          attempt < maxAttempts &&
          lastReason !== 'DOCUMENT_UPLOAD_ACCESS_DENIED'
        ) {
          await sleep(this.s3UploadRetryDelayMs());
        }

        if (lastReason === 'DOCUMENT_UPLOAD_ACCESS_DENIED') {
          break;
        }
      }
    }

    return { ok: false, reason: lastReason };
  }

  private async putObject(document: PlannedDocument): Promise<void> {
    const remainingTransientFailures = this.transientFailuresRemaining(
      document.key,
    );

    if (remainingTransientFailures > 0) {
      this.transientFailuresByKey.set(
        document.key,
        remainingTransientFailures - 1,
      );
      throw transientS3Failure();
    }

    await this.s3().send(
      new PutObjectCommand({
        Bucket: document.bucket,
        Key: document.key,
        Body: document.body,
        ContentType: document.contentType,
      }),
    );
  }

  private logS3UploadFailure(
    document: PlannedDocument,
    error: unknown,
    attempt: number,
    maxAttempts: number,
    reason: string,
  ): void {
    const fields = {
      s3_bucket: document.bucket,
      s3_key: document.key,
      attempt,
      max_attempts: maxAttempts,
      error_type: errorName(error),
      business_error_code: reason,
      result: reason,
      error_message: error instanceof Error ? error.message : 'unknown error',
    };

    if (attempt < maxAttempts && reason !== 'DOCUMENT_UPLOAD_ACCESS_DENIED') {
      this.logger.info('s3_put_object_retrying', fields);
    } else {
      this.logger.error('s3_put_object_failed', fields);
    }
  }

  private async publishOutcome(
    command: HandleCommitmentCommand,
    result: ShipmentCreateResult,
    version: string,
    startedAt: number,
  ): Promise<void> {
    const events = this.outcomeEvents(
      result.shipment,
      result.documents,
      command.event,
    );
    for (const event of events) {
      await this.publish(event, version);
    }

    const metricStatus = metricStatusFor(result.shipment.status);
    this.metrics.recordShipment(metricStatus, version);
    this.metrics.recordReadyBeforeCutoff(
      version,
      readyBeforeCutoff(result.shipment),
    );
    this.metrics.observeShipmentDuration(
      metricStatus,
      version,
      durationSeconds(startedAt),
    );

    if (result.documentUploadFailed) {
      this.metrics.recordDocumentFailure(version);
    }

    this.logger.info(logEventFor(result.shipment.status), {
      request_id: command.requestId,
      event_id: events.at(-1)?.event_id,
      event_name: events.at(-1)?.event_name,
      correlation_id: command.event.correlation_id,
      order_id: result.shipment.order_id,
      shipment_id: result.shipment.shipment_id,
      status_before: 'FULFILLMENT_COMMITTED',
      status_after: result.shipment.status,
      business_error_code: result.shipment.block_reason,
      duration_ms: durationMs(startedAt),
      result: result.shipment.status,
    });
  }

  private acceptDuplicate(
    command: HandleCommitmentCommand,
    shipment: ShipmentRecord,
    version: string,
    startedAt: number,
  ): ShipmentAcceptedResponse {
    this.metrics.recordShipment('duplicate_event_ignored', version);
    this.metrics.observeShipmentDuration(
      'duplicate_event_ignored',
      version,
      durationSeconds(startedAt),
    );
    this.logger.info('duplicate_fulfillment_commitment_ignored', {
      request_id: command.requestId,
      event_id: command.event.event_id,
      event_name: command.event.event_name,
      correlation_id: command.event.correlation_id,
      order_id: shipment.order_id,
      shipment_id: shipment.shipment_id,
      status_before: shipment.status,
      status_after: shipment.status,
      duration_ms: durationMs(startedAt),
      result: 'DUPLICATE_EVENT_IGNORED',
    });

    return response(shipment, true, version);
  }

  private outcomeEvents(
    shipment: ShipmentRecord,
    documents: DispatchDocumentRecord[],
    source: FulfillmentCommitmentEventDto,
  ): Array<EventEnvelope<Record<string, unknown>>> {
    if (shipment.status === 'DISPATCH_BLOCKED') {
      return [this.dispatchBlockedEvent(shipment, documents, source)];
    }

    return [
      this.dispatchDocumentsAvailableEvent(shipment, documents, source),
      this.readyToDispatchEvent(shipment, documents, source),
    ];
  }

  private dispatchDocumentsAvailableEvent(
    shipment: ShipmentRecord,
    documents: DispatchDocumentRecord[],
    source: FulfillmentCommitmentEventDto,
  ): EventEnvelope<Record<string, unknown>> {
    const occurredAt = new Date().toISOString();

    return {
      event_id: newId('evt'),
      event_name: 'shipping.dispatch_document_available.v1',
      event_version: '1.0',
      occurred_at: occurredAt,
      producer: 'shipment-preparation',
      correlation_id: source.correlation_id,
      causation_id: source.event_id,
      idempotency_key: `order_id:${shipment.order_id}:documents`,
      payload: {
        order_id: shipment.order_id,
        shipment_id: shipment.shipment_id,
        seller_id: shipment.seller_id,
        documents: documents.map(eventDocument),
        available_at: occurredAt,
      },
    };
  }

  private readyToDispatchEvent(
    shipment: ShipmentRecord,
    documents: DispatchDocumentRecord[],
    source: FulfillmentCommitmentEventDto,
  ): EventEnvelope<Record<string, unknown>> {
    const occurredAt = new Date().toISOString();

    return {
      event_id: newId('evt'),
      event_name: 'shipping.shipment_ready_to_dispatch.v1',
      event_version: '1.0',
      occurred_at: occurredAt,
      producer: 'shipment-preparation',
      correlation_id: source.correlation_id,
      causation_id: source.event_id,
      idempotency_key: `order_id:${shipment.order_id}`,
      payload: {
        order_id: shipment.order_id,
        shipment_id: shipment.shipment_id,
        seller_id: shipment.seller_id,
        label_status: 'AVAILABLE',
        documents: documents.map(eventDocument),
        seller_cutoff_at: shipment.seller_cutoff_at,
        ready_to_dispatch_at: shipment.ready_to_dispatch_at ?? occurredAt,
      },
    };
  }

  private dispatchBlockedEvent(
    shipment: ShipmentRecord,
    documents: DispatchDocumentRecord[],
    source: FulfillmentCommitmentEventDto,
  ): EventEnvelope<Record<string, unknown>> {
    const occurredAt = new Date().toISOString();

    return {
      event_id: newId('evt'),
      event_name: 'shipping.dispatch_blocked.v1',
      event_version: '1.0',
      occurred_at: occurredAt,
      producer: 'shipment-preparation',
      correlation_id: source.correlation_id,
      causation_id: source.event_id,
      idempotency_key: `order_id:${shipment.order_id}`,
      payload: {
        order_id: shipment.order_id,
        shipment_id: shipment.shipment_id,
        seller_id: shipment.seller_id,
        reason: shipment.block_reason ?? 'DISPATCH_BLOCKED',
        documents: documents.map(eventDocument),
        seller_cutoff_at: shipment.seller_cutoff_at,
        blocked_at: occurredAt,
      },
    };
  }

  private async publish(
    event: EventEnvelope<Record<string, unknown>>,
    version: string,
  ): Promise<void> {
    try {
      await this.sqs().send(
        new SendMessageCommand({
          QueueUrl: this.outputQueueUrl(),
          MessageBody: JSON.stringify(event),
        }),
      );
      this.metrics.recordSqsPublish('success', version, this.outputQueueName());
    } catch (error) {
      this.metrics.recordSqsPublish('failure', version, this.outputQueueName());
      this.logger.error('shipment_event_publish_failed', {
        event_id: event.event_id,
        event_name: event.event_name,
        correlation_id: event.correlation_id,
        order_id: stringValue(event.payload.order_id),
        shipment_id: stringValue(event.payload.shipment_id),
        business_error_code: 'SHIPMENT_EVENT_QUEUE_FAILED',
        result: 'SHIPMENT_EVENT_QUEUE_FAILED',
        error_message: error instanceof Error ? error.message : 'unknown error',
      });
      throw new ShipmentEventPublishError(error);
    }
  }

  private startWorkers(): void {
    if (!this.workerEnabled()) {
      return;
    }

    for (let index = 0; index < this.workerConcurrency(); index += 1) {
      this.workers.push(this.workerLoop(index));
    }
  }

  private async workerLoop(workerIndex: number): Promise<void> {
    while (!this.stopping) {
      try {
        const response = await this.sqs().send(
          new ReceiveMessageCommand({
            QueueUrl: this.inputQueueUrl(),
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: this.waitTimeSeconds(),
          }),
        );

        for (const message of response.Messages ?? []) {
          await this.processMessage(workerIndex, message);
        }
      } catch (error) {
        if (!this.stopping) {
          this.logger.error('shipment_worker_poll_failed', {
            queue: this.inputQueueName(),
            business_error_code: 'SHIPMENT_WORKER_POLL_FAILED',
            result: 'SHIPMENT_WORKER_POLL_FAILED',
            error_message:
              error instanceof Error ? error.message : 'unknown error',
          });
          await sleep(250);
        }
      }
    }
  }

  private async processMessage(
    workerIndex: number,
    message: { Body?: string; MessageId?: string; ReceiptHandle?: string },
  ): Promise<void> {
    const event = parseEvent(message.Body);

    if (!isFulfillmentCommitmentEvent(event)) {
      await this.deleteMessage(message.ReceiptHandle);
      return;
    }

    try {
      await this.handleCommitmentConfirmed({
        event,
        requestId: message.MessageId ?? event.event_id,
      });
      await this.deleteMessage(message.ReceiptHandle);
      this.logger.info('shipment_worker_message_processed', {
        event_id: event.event_id,
        event_name: event.event_name,
        correlation_id: event.correlation_id,
        order_id: event.payload.order_id,
        queue: this.inputQueueName(),
        result: 'MESSAGE_PROCESSED',
        detail: `worker:${workerIndex}`,
      });
    } catch {
      // Leave the message in SQS so the queue redrive policy can move it to DLQ.
    }
  }

  private async deleteMessage(
    receiptHandle: string | undefined,
  ): Promise<void> {
    if (!receiptHandle) {
      return;
    }

    await this.sqs().send(
      new DeleteMessageCommand({
        QueueUrl: this.inputQueueUrl(),
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private async ensureSchema(): Promise<void> {
    await this.db().query(`
      CREATE TABLE IF NOT EXISTS shipments (
        shipment_id TEXT PRIMARY KEY,
        order_id TEXT UNIQUE NOT NULL,
        fulfillment_commitment_id TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        status TEXT NOT NULL,
        seller_cutoff_at TIMESTAMPTZ NOT NULL,
        ready_to_dispatch_at TIMESTAMPTZ,
        block_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);
    await this.db().query(`
      CREATE TABLE IF NOT EXISTS dispatch_documents (
        document_id TEXT PRIMARY KEY,
        shipment_id TEXT NOT NULL REFERENCES shipments(shipment_id),
        document_type TEXT NOT NULL,
        s3_bucket TEXT NOT NULL,
        s3_key TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        UNIQUE (shipment_id, document_type)
      )
    `);
  }

  private db(): Pool {
    if (!this.pool) {
      this.pool = new Pool({ connectionString: this.databaseUrl() });
    }

    return this.pool;
  }

  private databaseUrl(): string {
    return this.config.get<string>(
      'DATABASE_URL',
      'postgresql://shipment:shipment@localhost:15434/shipment_preparation',
    );
  }

  private sqs(): SQSClient {
    if (!this.sqsClient) {
      this.sqsClient = new SQSClient({
        region: this.region(),
        endpoint: this.awsEndpoint(),
        credentials: this.credentials(),
      });
    }

    return this.sqsClient;
  }

  private s3(): S3Client {
    if (!this.s3Client) {
      this.s3Client = new S3Client({
        region: this.region(),
        endpoint: this.s3Endpoint(),
        forcePathStyle: true,
        credentials: this.credentials(),
      });
    }

    return this.s3Client;
  }

  private region(): string {
    return this.config.get<string>('AWS_REGION', 'us-east-1');
  }

  private inputQueueUrl(): string {
    return this.config.get<string>(
      'INPUT_SQS_QUEUE_URL',
      'http://localhost:4566/000000000000/fulfillment-commitment-intake',
    );
  }

  private outputQueueUrl(): string {
    return this.config.get<string>(
      'SQS_QUEUE_URL',
      'http://localhost:4566/000000000000/buyer-tracking-events',
    );
  }

  private inputQueueName(): string {
    return (
      this.inputQueueUrl().split('/').pop() ?? 'fulfillment-commitment-intake'
    );
  }

  private outputQueueName(): string {
    return this.outputQueueUrl().split('/').pop() ?? 'buyer-tracking-events';
  }

  private bucketName(): string {
    return this.config.get<string>(
      'SHIPMENT_DOCUMENTS_BUCKET',
      'seller-dispatch-documents-lab',
    );
  }

  private awsEndpoint(): string | undefined {
    const endpoint =
      this.config.get<string>('SQS_ENDPOINT') ??
      this.config.get<string>('AWS_ENDPOINT_URL');

    if (endpoint) {
      return endpoint;
    }

    return [this.inputQueueUrl(), this.outputQueueUrl()].some((queueUrl) =>
      queueUrl.startsWith('http://localhost:4566'),
    )
      ? 'http://localhost:4566'
      : undefined;
  }

  private s3Endpoint(): string | undefined {
    return (
      this.config.get<string>('S3_ENDPOINT') ??
      this.config.get<string>('AWS_ENDPOINT_URL') ??
      (this.awsEndpoint() ? this.awsEndpoint() : undefined)
    );
  }

  private credentials():
    | { accessKeyId: string; secretAccessKey: string }
    | undefined {
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');

    if (accessKeyId && secretAccessKey) {
      return { accessKeyId, secretAccessKey };
    }

    if (this.awsEndpoint() || this.s3Endpoint()) {
      return { accessKeyId: 'test', secretAccessKey: 'test' };
    }

    return undefined;
  }

  private workerEnabled(): boolean {
    return this.config.get<string>('WORKER_ENABLED', 'true') !== 'false';
  }

  private workerConcurrency(): number {
    const value = Number(this.config.get<string>('WORKER_CONCURRENCY', '1'));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
  }

  private waitTimeSeconds(): number {
    const value = Number(this.config.get<string>('SQS_WAIT_TIME_SECONDS', '1'));
    return Number.isFinite(value) && value >= 0 && value <= 20
      ? Math.floor(value)
      : 1;
  }

  private s3PutObjectAllowed(): boolean {
    return this.config.get<string>('S3_PUT_OBJECT_ALLOWED', 'true') !== 'false';
  }

  private s3BadKeyEnabled(): boolean {
    return this.config.get<string>('S3_BAD_KEY_ENABLED', 'false') === 'true';
  }

  private s3UploadMaxAttempts(): number {
    const value = Number(
      this.config.get<string>('S3_UPLOAD_MAX_ATTEMPTS', '2'),
    );
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 2;
  }

  private s3UploadRetryDelayMs(): number {
    const value = Number(
      this.config.get<string>('S3_UPLOAD_RETRY_DELAY_MS', '25'),
    );
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 25;
  }

  private transientFailuresRemaining(key: string): number {
    if (!this.transientFailuresByKey.has(key)) {
      const configured = Number(
        this.config.get<string>('S3_TRANSIENT_FAILURES_BEFORE_SUCCESS', '0'),
      );
      this.transientFailuresByKey.set(
        key,
        Number.isFinite(configured) && configured > 0
          ? Math.floor(configured)
          : 0,
      );
    }

    return this.transientFailuresByKey.get(key) ?? 0;
  }

  private sellerCutoffAt(): string {
    const date = new Date();

    if (this.config.get<string>('SELLER_CUTOFF_EXPIRED', 'false') === 'true') {
      date.setUTCMinutes(date.getUTCMinutes() - 1);
    } else {
      date.setUTCHours(date.getUTCHours() + 24);
    }

    return date.toISOString();
  }
}

class ShipmentEventPublishError extends Error {
  constructor(readonly cause: unknown) {
    super('shipment event could not be published');
  }
}

function shipmentSelectSql(): string {
  return `SELECT shipment_id, order_id, fulfillment_commitment_id, seller_id, status,
                 seller_cutoff_at, ready_to_dispatch_at, block_reason, created_at, updated_at
          FROM shipments`;
}

function toShipment(row: ShipmentRow): ShipmentRecord {
  return {
    shipment_id: row.shipment_id,
    order_id: row.order_id,
    fulfillment_commitment_id: row.fulfillment_commitment_id,
    seller_id: row.seller_id,
    status: row.status,
    seller_cutoff_at: isoString(row.seller_cutoff_at),
    ready_to_dispatch_at: row.ready_to_dispatch_at
      ? isoString(row.ready_to_dispatch_at)
      : undefined,
    block_reason: row.block_reason,
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  };
}

function toDocument(row: DocumentRow): DispatchDocumentRecord {
  return {
    document_id: row.document_id,
    shipment_id: row.shipment_id,
    document_type: row.document_type,
    s3_bucket: row.s3_bucket,
    s3_key: row.s3_key,
    status: row.status,
    created_at: isoString(row.created_at),
  };
}

function eventDocument(
  document: DispatchDocumentRecord,
): Record<string, string> {
  return {
    type: document.document_type,
    bucket: document.s3_bucket,
    key: document.s3_key,
    status: document.status,
  };
}

function response(
  shipment: ShipmentRecord,
  duplicate: boolean,
  version: string,
): ShipmentAcceptedResponse {
  return {
    shipment_id: shipment.shipment_id,
    order_id: shipment.order_id,
    status: shipment.status,
    duplicate,
    version,
    reason: shipment.block_reason,
  };
}

function metricStatusFor(
  status: ShipmentStatus,
): 'ready_to_dispatch' | 'dispatch_blocked' {
  return status === 'READY_TO_DISPATCH'
    ? 'ready_to_dispatch'
    : 'dispatch_blocked';
}

function logEventFor(status: ShipmentStatus): string {
  return status === 'READY_TO_DISPATCH'
    ? 'shipment_ready_to_dispatch'
    : 'shipment_dispatch_blocked';
}

function processingFailureCode(error: unknown): string {
  if (error instanceof ShipmentEventPublishError) {
    return 'SHIPMENT_EVENT_QUEUE_FAILED';
  }

  if (isPgUniqueViolation(error)) {
    return 'SHIPMENT_IDEMPOTENCY_CONFLICT';
  }

  return 'SHIPMENT_PERSISTENCE_FAILED';
}

function s3FailureCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const name = (error as { name?: unknown }).name;
    const code = (error as { Code?: unknown; code?: unknown }).Code;

    if (name === 'AccessDenied' || code === 'AccessDenied') {
      return 'DOCUMENT_UPLOAD_ACCESS_DENIED';
    }
  }

  return 'DOCUMENT_UPLOAD_FAILED';
}

function firstUploadFailureReason(results: UploadResult[]): string {
  return (
    results.find((result) => !result.ok)?.reason ?? 'DOCUMENT_UPLOAD_FAILED'
  );
}

function blockReason(
  uploadSucceeded: boolean,
  cutoffExpired: boolean,
  uploadResults: UploadResult[],
): string | undefined {
  if (!uploadSucceeded) {
    return firstUploadFailureReason(uploadResults);
  }

  return cutoffExpired ? 'SELLER_CUTOFF_EXPIRED' : undefined;
}

function readyBeforeCutoff(shipment: ShipmentRecord): boolean {
  return (
    shipment.status === 'READY_TO_DISPATCH' &&
    !!shipment.ready_to_dispatch_at &&
    !isCutoffExpired(shipment.seller_cutoff_at, shipment.ready_to_dispatch_at)
  );
}

function isCutoffExpired(
  sellerCutoffAt: string,
  referenceTime: string,
): boolean {
  return new Date(referenceTime).getTime() > new Date(sellerCutoffAt).getTime();
}

function isValidDocumentKey(key: string): boolean {
  return /^shipments\/shp_[^/]+\/(labels\/shipping-label\.pdf|instructions\/dispatch-instructions\.json)$/.test(
    key,
  );
}

function transientS3Failure(): Error {
  const error = new Error('transient S3 PutObject failure');
  error.name = 'InternalError';
  return error;
}

function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string') {
      return name;
    }
  }

  return 'Error';
}

function isPgUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function parseEvent(body: string | undefined): unknown {
  if (!body) {
    return undefined;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function isFulfillmentCommitmentEvent(
  value: unknown,
): value is FulfillmentCommitmentEventDto {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { event_name?: unknown }).event_name ===
      'fulfillment.commitment_confirmed.v1' &&
    typeof (value as { event_id?: unknown }).event_id === 'string' &&
    typeof (value as { correlation_id?: unknown }).correlation_id ===
      'string' &&
    typeof (value as { payload?: { order_id?: unknown } }).payload?.order_id ===
      'string' &&
    typeof (value as { payload?: { fulfillment_commitment_id?: unknown } })
      .payload?.fulfillment_commitment_id === 'string'
  );
}

function durationMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function durationSeconds(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt) / 1000;
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
