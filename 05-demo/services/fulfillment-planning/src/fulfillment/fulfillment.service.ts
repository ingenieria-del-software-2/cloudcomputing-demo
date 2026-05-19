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
import {
  OrderConfirmedEventDto,
  OrderConfirmedItemDto,
} from './order-confirmed-event.dto';

type FulfillmentStatus =
  | 'FULFILLMENT_COMMITTED'
  | 'FULFILLMENT_FAILED'
  | 'FULFILLMENT_AT_RISK';
type FulfillmentModel = 'promesa_express' | 'standard';

interface EventEnvelope<TPayload> {
  event_id: string;
  event_name: string;
  event_version: '1.0';
  occurred_at: string;
  producer: 'fulfillment-planning';
  correlation_id: string;
  causation_id: string;
  idempotency_key: string;
  payload: TPayload;
}

interface HandleOrderConfirmedCommand {
  event: OrderConfirmedEventDto;
  requestId: string;
}

export interface ReservedItemRecord {
  seller_sku: string;
  quantity: number;
  reservation_id: string;
}

export interface FailedItemRecord {
  seller_sku: string;
  requested_quantity: number;
  available_quantity: number;
}

export interface FulfillmentCommitmentRecord {
  fulfillment_commitment_id: string;
  order_id: string;
  seller_id: string;
  fulfillment_model: FulfillmentModel;
  origin_type: 'seller_location';
  estimated_delivery_date?: string;
  status: FulfillmentStatus;
  reserved_items: ReservedItemRecord[];
  failed_items: FailedItemRecord[];
  reason?: string;
  committed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface InventoryItemRecord {
  seller_sku: string;
  seller_id: string;
  available_quantity: number;
  reserved_quantity: number;
  updated_at: string;
}

export interface FulfillmentAcceptedResponse {
  order_id: string;
  fulfillment_commitment_id: string;
  status: FulfillmentStatus;
  duplicate: boolean;
  version: string;
  reason?: string;
}

interface CommitmentCreateResult {
  commitment: FulfillmentCommitmentRecord;
  duplicate: boolean;
  promesaExpressFailed: boolean;
  event?: EventEnvelope<Record<string, unknown>>;
}

interface OutboxEvent {
  event: EventEnvelope<Record<string, unknown>>;
  queueName: string;
  queueUrl: string;
}

interface OutboxRow extends QueryResultRow {
  outbox_id: string;
  event_name: string;
  queue_name: string;
  queue_url: string;
  payload: EventEnvelope<Record<string, unknown>>;
  attempt_count: number;
}

interface CommitmentRow extends QueryResultRow {
  commitment_id: string;
  order_id: string;
  seller_id: string;
  fulfillment_model: FulfillmentModel;
  origin_type: 'seller_location';
  estimated_delivery_date?: string;
  status: FulfillmentStatus;
  reserved_items: ReservedItemRecord[];
  failed_items: FailedItemRecord[];
  reason?: string;
  committed_at?: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface InventoryRow extends QueryResultRow {
  seller_sku: string;
  seller_id: string;
  available_quantity: number;
  reserved_quantity: number;
  updated_at: Date | string;
}

interface PromiseMode {
  fulfillmentModel: FulfillmentModel;
  status: Exclude<FulfillmentStatus, 'FULFILLMENT_FAILED'>;
  estimatedDeliveryDate: string;
  reason?: string;
  promesaExpressFailed: boolean;
}

@Injectable()
export class FulfillmentService implements OnModuleInit, OnModuleDestroy {
  private pool?: Pool;
  private sqsClient?: SQSClient;
  private stopping = false;
  private workers: Promise<void>[] = [];
  private outboxTimer?: NodeJS.Timeout;
  private publishingOutbox = false;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
    await this.resetInterruptedOutboxRows();
    this.startOutboxPublisher();
    this.startWorkers();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.outboxTimer) {
      clearInterval(this.outboxTimer);
    }
    this.sqsClient?.destroy();
    await Promise.allSettled(this.workers);
    await this.pool?.end();
  }

  async handleOrderConfirmed(
    command: HandleOrderConfirmedCommand,
  ): Promise<FulfillmentAcceptedResponse> {
    const startedAt = performance.now();
    const version = this.config.get<string>('SERVICE_VERSION', 'v1');

    try {
      const result = await this.createOrReplayCommitment(command.event);

      if (result.duplicate) {
        return this.acceptDuplicate(
          command,
          result.commitment,
          version,
          startedAt,
        );
      }

      await this.publishOutcome(command, result, version, startedAt);
      return response(result.commitment, false, version);
    } catch (error) {
      this.metrics.recordFulfillment('processing_failed', version);
      this.metrics.observeCommitmentDuration(
        'processing_failed',
        version,
        durationSeconds(startedAt),
      );
      this.metrics.recordDeliveryPromiseSlo(
        version,
        deliveryPromiseDurationSeconds(command.event),
        false,
      );
      this.logger.error('fulfillment_processing_failed', {
        request_id: command.requestId,
        event_id: command.event.event_id,
        event_name: command.event.event_name,
        correlation_id: command.event.correlation_id,
        order_id: command.event.payload.order_id,
        payment_id: command.event.payload.payment_id,
        status_before: 'ORDER_CONFIRMED',
        status_after: 'FULFILLMENT_FAILED',
        business_error_code: processingFailureCode(error),
        duration_ms: durationMs(startedAt),
        result: 'FULFILLMENT_PROCESSING_FAILED',
        error_message: error instanceof Error ? error.message : 'unknown error',
      });
      throw new ServiceUnavailableException({
        status: 503,
        code: 'FULFILLMENT_COMMITMENT_FAILED',
        message: 'Fulfillment commitment could not be processed',
      });
    }
  }

  async findCommitmentByOrderId(
    orderId: string,
  ): Promise<FulfillmentCommitmentRecord | undefined> {
    const result = await this.db().query<CommitmentRow>(commitmentSelectSql(), [
      orderId,
    ]);

    return result.rows[0] ? toCommitment(result.rows[0]) : undefined;
  }

  async findInventoryItem(
    sellerSku: string,
  ): Promise<InventoryItemRecord | undefined> {
    const result = await this.db().query<InventoryRow>(
      `SELECT seller_sku, seller_id, available_quantity, reserved_quantity, updated_at
       FROM inventory_items
       WHERE seller_sku = $1`,
      [sellerSku],
    );

    return result.rows[0] ? toInventoryItem(result.rows[0]) : undefined;
  }

  private async createOrReplayCommitment(
    event: OrderConfirmedEventDto,
  ): Promise<CommitmentCreateResult> {
    const promiseMode = await this.evaluatePromiseMode();
    const client = await this.db().connect();

    try {
      await client.query('BEGIN');

      const existing = await this.findCommitmentByOrderIdForUpdate(
        client,
        event.payload.order_id,
      );
      if (existing) {
        await client.query('COMMIT');
        return {
          commitment: existing,
          duplicate: true,
          promesaExpressFailed: false,
        };
      }

      const inventory = await this.lockInventory(client, event.payload.items);
      const failedItems = unavailableItems(event.payload.items, inventory);
      const now = new Date().toISOString();

      if (failedItems.length > 0) {
        const commitment = await this.insertCommitment(client, {
          commitmentId: newId('fc'),
          orderId: event.payload.order_id,
          sellerId: event.payload.seller_id,
          fulfillmentModel: 'standard',
          estimatedDeliveryDate: undefined,
          status: 'FULFILLMENT_FAILED',
          reservedItems: [],
          failedItems,
          reason: 'STOCK_UNAVAILABLE',
          committedAt: undefined,
          createdAt: now,
        });
        await this.insertFulfillmentTransition(client, {
          commitment,
          statusFrom: 'ORDER_CONFIRMED',
          causationId: event.event_id,
          changedAt: now,
        });
        const events = this.outboxEventsFor(commitment, event);
        await this.insertOutboxEvents(client, events, now);
        await client.query('COMMIT');
        return {
          commitment,
          duplicate: false,
          promesaExpressFailed: false,
          event: events[0]?.event,
        };
      }

      const reservedItems = await this.reserveInventory(
        client,
        event.payload.order_id,
        event.payload.items,
        now,
      );
      const commitment = await this.insertCommitment(client, {
        commitmentId: newId('fc'),
        orderId: event.payload.order_id,
        sellerId: event.payload.seller_id,
        fulfillmentModel: promiseMode.fulfillmentModel,
        estimatedDeliveryDate: promiseMode.estimatedDeliveryDate,
        status: promiseMode.status,
        reservedItems,
        failedItems: [],
        reason: promiseMode.reason,
        committedAt: now,
        createdAt: now,
      });
      await this.insertFulfillmentTransition(client, {
        commitment,
        statusFrom: 'ORDER_CONFIRMED',
        causationId: event.event_id,
        changedAt: now,
      });
      const events = this.outboxEventsFor(commitment, event);
      await this.insertOutboxEvents(client, events, now);
      await client.query('COMMIT');

      return {
        commitment,
        duplicate: false,
        promesaExpressFailed: promiseMode.promesaExpressFailed,
        event: events[0]?.event,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);

      if (isPgUniqueViolation(error)) {
        const existing = await this.findCommitmentByOrderId(
          event.payload.order_id,
        );
        if (existing) {
          return {
            commitment: existing,
            duplicate: true,
            promesaExpressFailed: false,
          };
        }
      }

      throw error;
    } finally {
      client.release();
    }
  }

  private async findCommitmentByOrderIdForUpdate(
    client: PoolClient,
    orderId: string,
  ): Promise<FulfillmentCommitmentRecord | undefined> {
    const result = await client.query<CommitmentRow>(
      `${commitmentSelectSql()} FOR UPDATE`,
      [orderId],
    );

    return result.rows[0] ? toCommitment(result.rows[0]) : undefined;
  }

  private async lockInventory(
    client: PoolClient,
    items: OrderConfirmedItemDto[],
  ): Promise<Map<string, InventoryItemRecord>> {
    const inventory = new Map<string, InventoryItemRecord>();

    for (const sellerSku of sellerSkus(items)) {
      const result = await client.query<InventoryRow>(
        `SELECT seller_sku, seller_id, available_quantity, reserved_quantity, updated_at
         FROM inventory_items
         WHERE seller_sku = $1
         FOR UPDATE`,
        [sellerSku],
      );

      if (result.rows[0]) {
        inventory.set(sellerSku, toInventoryItem(result.rows[0]));
      }
    }

    return inventory;
  }

  private async reserveInventory(
    client: PoolClient,
    orderId: string,
    items: OrderConfirmedItemDto[],
    createdAt: string,
  ): Promise<ReservedItemRecord[]> {
    const reservedItems: ReservedItemRecord[] = [];

    for (const item of aggregateItems(items)) {
      await client.query(
        `UPDATE inventory_items
         SET available_quantity = available_quantity - $2,
             reserved_quantity = reserved_quantity + $2,
             updated_at = $3
         WHERE seller_sku = $1
           AND available_quantity >= $2`,
        [item.seller_sku, item.quantity, createdAt],
      );

      const reservationId = newId('res');
      await client.query(
        `INSERT INTO inventory_reservations (
           reservation_id, order_id, seller_sku, quantity, status, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          reservationId,
          orderId,
          item.seller_sku,
          item.quantity,
          'STOCK_RESERVED',
          createdAt,
        ],
      );

      reservedItems.push({
        seller_sku: item.seller_sku,
        quantity: item.quantity,
        reservation_id: reservationId,
      });
    }

    return reservedItems;
  }

  private async insertCommitment(
    client: PoolClient,
    input: {
      commitmentId: string;
      orderId: string;
      sellerId: string;
      fulfillmentModel: FulfillmentModel;
      estimatedDeliveryDate?: string;
      status: FulfillmentStatus;
      reservedItems: ReservedItemRecord[];
      failedItems: FailedItemRecord[];
      reason?: string;
      committedAt?: string;
      createdAt: string;
    },
  ): Promise<FulfillmentCommitmentRecord> {
    const result = await client.query<CommitmentRow>(
      `INSERT INTO fulfillment_commitments (
         commitment_id, order_id, seller_id, fulfillment_model, origin_type,
         estimated_delivery_date, status, reserved_items, failed_items, reason,
         committed_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $12)
       RETURNING commitment_id, order_id, seller_id, fulfillment_model, origin_type,
                 estimated_delivery_date, status, reserved_items, failed_items, reason,
                 committed_at, created_at, updated_at`,
      [
        input.commitmentId,
        input.orderId,
        input.sellerId,
        input.fulfillmentModel,
        'seller_location',
        input.estimatedDeliveryDate,
        input.status,
        JSON.stringify(input.reservedItems),
        JSON.stringify(input.failedItems),
        input.reason,
        input.committedAt,
        input.createdAt,
      ],
    );

    return toCommitment(result.rows[0]);
  }

  private async insertFulfillmentTransition(
    client: PoolClient,
    input: {
      commitment: FulfillmentCommitmentRecord;
      statusFrom: string;
      causationId: string;
      changedAt: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO fulfillment_state_transitions (
         transition_id, order_id, commitment_id, status_from, status_to,
         causation_id, changed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        newId('trn'),
        input.commitment.order_id,
        input.commitment.fulfillment_commitment_id,
        input.statusFrom,
        input.commitment.status,
        input.causationId,
        input.changedAt,
      ],
    );
  }

  private outboxEventsFor(
    commitment: FulfillmentCommitmentRecord,
    source: OrderConfirmedEventDto,
  ): OutboxEvent[] {
    const outcome = this.outcomeEvent(commitment, source);
    const events: OutboxEvent[] = [
      {
        event: outcome,
        queueName: this.outputQueueName(),
        queueUrl: this.outputQueueUrl(),
      },
    ];
    const trackingQueueUrl = this.trackingQueueUrl();

    if (trackingQueueUrl) {
      events.push({
        event: outcome,
        queueName: this.trackingQueueName(),
        queueUrl: trackingQueueUrl,
      });
    }

    for (const event of this.inventoryEvents(commitment, source)) {
      events.push({
        event,
        queueName: this.inventoryQueueName(),
        queueUrl: this.inventoryQueueUrl(),
      });
    }

    return events;
  }

  private inventoryEvents(
    commitment: FulfillmentCommitmentRecord,
    source: OrderConfirmedEventDto,
  ): Array<EventEnvelope<Record<string, unknown>>> {
    if (commitment.failed_items.length > 0) {
      return [this.inventoryStockReservationFailedEvent(commitment, source)];
    }

    if (commitment.reserved_items.length > 0) {
      return [this.inventoryStockReservedEvent(commitment, source)];
    }

    return [];
  }

  private async insertOutboxEvents(
    client: PoolClient,
    events: OutboxEvent[],
    createdAt: string,
  ): Promise<void> {
    for (const item of events) {
      await client.query(
        `INSERT INTO event_outbox (
           outbox_id, event_id, event_name, queue_name, queue_url, payload,
           status, attempt_count, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'PENDING', 0, $7, $7)`,
        [
          newId('out'),
          item.event.event_id,
          item.event.event_name,
          item.queueName,
          item.queueUrl,
          JSON.stringify(item.event),
          createdAt,
        ],
      );
    }
  }

  private async publishOutcome(
    command: HandleOrderConfirmedCommand,
    result: CommitmentCreateResult,
    version: string,
    startedAt: number,
  ): Promise<void> {
    await this.publishPendingOutbox(version);

    const metricStatus = metricStatusFor(result.commitment.status);
    this.metrics.recordFulfillment(metricStatus, version);
    this.metrics.observeCommitmentDuration(
      metricStatus,
      version,
      durationSeconds(startedAt),
    );
    this.metrics.recordDeliveryPromiseSlo(
      version,
      deliveryPromiseDurationSeconds(command.event),
      result.commitment.status !== 'FULFILLMENT_FAILED' &&
        Boolean(result.commitment.estimated_delivery_date),
    );
    this.metrics.recordStockShortageCancellationSlo(
      version,
      result.commitment.reason !== 'STOCK_UNAVAILABLE',
    );

    if (result.commitment.estimated_delivery_date) {
      this.metrics.recordDeliveryPromiseStability(version, true);
    }

    if (result.promesaExpressFailed) {
      this.metrics.recordPromesaExpressFailure(version);
    }

    this.logger.info(logEventFor(result.commitment.status), {
      request_id: command.requestId,
      event_id: result.event?.event_id,
      event_name: result.event?.event_name,
      correlation_id:
        result.event?.correlation_id ?? command.event.correlation_id,
      order_id: result.commitment.order_id,
      payment_id: command.event.payload.payment_id,
      fulfillment_commitment_id: result.commitment.fulfillment_commitment_id,
      status_before: 'ORDER_CONFIRMED',
      status_after: result.commitment.status,
      business_error_code: result.commitment.reason,
      duration_ms: durationMs(startedAt),
      result: result.commitment.status,
      feature_promesa_express: this.promesaExpressEnabled(),
    });
  }

  private acceptDuplicate(
    command: HandleOrderConfirmedCommand,
    commitment: FulfillmentCommitmentRecord,
    version: string,
    startedAt: number,
  ): FulfillmentAcceptedResponse {
    this.metrics.recordFulfillment('duplicate_event_ignored', version);
    this.metrics.observeCommitmentDuration(
      'duplicate_event_ignored',
      version,
      durationSeconds(startedAt),
    );
    this.logger.info('duplicate_order_confirmed_ignored', {
      request_id: command.requestId,
      event_id: command.event.event_id,
      event_name: command.event.event_name,
      correlation_id: command.event.correlation_id,
      order_id: commitment.order_id,
      payment_id: command.event.payload.payment_id,
      fulfillment_commitment_id: commitment.fulfillment_commitment_id,
      status_before: commitment.status,
      status_after: commitment.status,
      duration_ms: durationMs(startedAt),
      result: 'DUPLICATE_EVENT_IGNORED',
    });

    return response(commitment, true, version);
  }

  private outcomeEvent(
    commitment: FulfillmentCommitmentRecord,
    source: OrderConfirmedEventDto,
  ): EventEnvelope<Record<string, unknown>> {
    if (commitment.status === 'FULFILLMENT_FAILED') {
      return this.commitmentFailedEvent(commitment, source);
    }

    if (commitment.status === 'FULFILLMENT_AT_RISK') {
      return this.commitmentAtRiskEvent(commitment, source);
    }

    return this.commitmentConfirmedEvent(commitment, source);
  }

  private commitmentConfirmedEvent(
    commitment: FulfillmentCommitmentRecord,
    source: OrderConfirmedEventDto,
  ): EventEnvelope<Record<string, unknown>> {
    const occurredAt = new Date().toISOString();

    return {
      event_id: newId('evt'),
      event_name: 'fulfillment.commitment_confirmed.v1',
      event_version: '1.0',
      occurred_at: occurredAt,
      producer: 'fulfillment-planning',
      correlation_id: source.correlation_id,
      causation_id: source.event_id,
      idempotency_key: `order_id:${commitment.order_id}`,
      payload: {
        order_id: commitment.order_id,
        payment_id: source.payload.payment_id,
        buyer_id: source.payload.buyer_id,
        fulfillment_commitment_id: commitment.fulfillment_commitment_id,
        seller_id: commitment.seller_id,
        fulfillment_model: commitment.fulfillment_model,
        origin_type: commitment.origin_type,
        estimated_delivery_date: commitment.estimated_delivery_date,
        reserved_items: commitment.reserved_items,
        payment_approved_at: source.payload.payment_approved_at,
        committed_at: commitment.committed_at,
      },
    };
  }

  private commitmentFailedEvent(
    commitment: FulfillmentCommitmentRecord,
    source: OrderConfirmedEventDto,
  ): EventEnvelope<Record<string, unknown>> {
    const occurredAt = new Date().toISOString();

    return {
      event_id: newId('evt'),
      event_name: 'fulfillment.commitment_failed.v1',
      event_version: '1.0',
      occurred_at: occurredAt,
      producer: 'fulfillment-planning',
      correlation_id: source.correlation_id,
      causation_id: source.event_id,
      idempotency_key: `order_id:${commitment.order_id}`,
      payload: {
        order_id: commitment.order_id,
        payment_id: source.payload.payment_id,
        buyer_id: source.payload.buyer_id,
        reason: commitment.reason ?? 'FULFILLMENT_FAILED',
        failed_items: commitment.failed_items,
        payment_approved_at: source.payload.payment_approved_at,
        failed_at: occurredAt,
      },
    };
  }

  private commitmentAtRiskEvent(
    commitment: FulfillmentCommitmentRecord,
    source: OrderConfirmedEventDto,
  ): EventEnvelope<Record<string, unknown>> {
    const occurredAt = new Date().toISOString();

    return {
      event_id: newId('evt'),
      event_name: 'fulfillment.commitment_at_risk.v1',
      event_version: '1.0',
      occurred_at: occurredAt,
      producer: 'fulfillment-planning',
      correlation_id: source.correlation_id,
      causation_id: source.event_id,
      idempotency_key: `order_id:${commitment.order_id}`,
      payload: {
        order_id: commitment.order_id,
        payment_id: source.payload.payment_id,
        buyer_id: source.payload.buyer_id,
        fulfillment_commitment_id: commitment.fulfillment_commitment_id,
        seller_id: commitment.seller_id,
        fulfillment_model: commitment.fulfillment_model,
        origin_type: commitment.origin_type,
        estimated_delivery_date: commitment.estimated_delivery_date,
        reserved_items: commitment.reserved_items,
        reason: commitment.reason ?? 'FULFILLMENT_AT_RISK',
        payment_approved_at: source.payload.payment_approved_at,
        at_risk_at: occurredAt,
      },
    };
  }

  private inventoryStockReservedEvent(
    commitment: FulfillmentCommitmentRecord,
    source: OrderConfirmedEventDto,
  ): EventEnvelope<Record<string, unknown>> {
    const occurredAt = new Date().toISOString();

    return {
      event_id: newId('evt'),
      event_name: 'inventory.stock_reserved.v1',
      event_version: '1.0',
      occurred_at: occurredAt,
      producer: 'fulfillment-planning',
      correlation_id: source.correlation_id,
      causation_id: source.event_id,
      idempotency_key: `order_id:${commitment.order_id}:inventory`,
      payload: {
        order_id: commitment.order_id,
        payment_id: source.payload.payment_id,
        buyer_id: source.payload.buyer_id,
        fulfillment_commitment_id: commitment.fulfillment_commitment_id,
        seller_id: commitment.seller_id,
        reserved_items: commitment.reserved_items,
        payment_approved_at: source.payload.payment_approved_at,
        reserved_at: occurredAt,
      },
    };
  }

  private inventoryStockReservationFailedEvent(
    commitment: FulfillmentCommitmentRecord,
    source: OrderConfirmedEventDto,
  ): EventEnvelope<Record<string, unknown>> {
    const occurredAt = new Date().toISOString();

    return {
      event_id: newId('evt'),
      event_name: 'inventory.stock_reservation_failed.v1',
      event_version: '1.0',
      occurred_at: occurredAt,
      producer: 'fulfillment-planning',
      correlation_id: source.correlation_id,
      causation_id: source.event_id,
      idempotency_key: `order_id:${commitment.order_id}:inventory`,
      payload: {
        order_id: commitment.order_id,
        payment_id: source.payload.payment_id,
        buyer_id: source.payload.buyer_id,
        fulfillment_commitment_id: commitment.fulfillment_commitment_id,
        seller_id: commitment.seller_id,
        failed_items: commitment.failed_items,
        payment_approved_at: source.payload.payment_approved_at,
        reservation_failed_at: occurredAt,
      },
    };
  }

  private async publish(
    event: EventEnvelope<Record<string, unknown>>,
    version: string,
  ): Promise<void> {
    try {
      await this.client().send(
        new SendMessageCommand({
          QueueUrl: this.outputQueueUrl(),
          MessageBody: JSON.stringify(event),
        }),
      );
      this.metrics.recordSqsPublish('success', version, this.outputQueueName());
    } catch (error) {
      this.metrics.recordSqsPublish('failure', version, this.outputQueueName());
      this.logger.error('fulfillment_event_publish_failed', {
        event_id: event.event_id,
        event_name: event.event_name,
        correlation_id: event.correlation_id,
        order_id: stringValue(event.payload.order_id),
        fulfillment_commitment_id: stringValue(
          event.payload.fulfillment_commitment_id,
        ),
        business_error_code: 'FULFILLMENT_EVENT_QUEUE_FAILED',
        result: 'FULFILLMENT_EVENT_QUEUE_FAILED',
        error_message: error instanceof Error ? error.message : 'unknown error',
      });
      throw new FulfillmentEventPublishError(error);
    }
  }

  private async publishTrackingCopy(
    event: EventEnvelope<Record<string, unknown>>,
    version: string,
  ): Promise<void> {
    const queueUrl = this.trackingQueueUrl();

    if (!queueUrl) {
      return;
    }

    try {
      await this.client().send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(event),
        }),
      );
      this.metrics.recordSqsPublish(
        'success',
        version,
        this.trackingQueueName(),
      );
    } catch (error) {
      this.metrics.recordSqsPublish(
        'failure',
        version,
        this.trackingQueueName(),
      );
      this.logger.error('fulfillment_tracking_event_publish_failed', {
        event_id: event.event_id,
        event_name: event.event_name,
        correlation_id: event.correlation_id,
        order_id: stringValue(event.payload.order_id),
        fulfillment_commitment_id: stringValue(
          event.payload.fulfillment_commitment_id,
        ),
        business_error_code: 'FULFILLMENT_TRACKING_QUEUE_FAILED',
        result: 'FULFILLMENT_TRACKING_QUEUE_FAILED',
        error_message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  private startOutboxPublisher(): void {
    if (
      this.config.get<string>('OUTBOX_PUBLISHER_ENABLED', 'true') === 'false'
    ) {
      return;
    }

    void this.publishPendingOutbox(
      this.config.get<string>('SERVICE_VERSION', 'v1'),
    );
    this.outboxTimer = setInterval(() => {
      void this.publishPendingOutbox(
        this.config.get<string>('SERVICE_VERSION', 'v1'),
      );
    }, this.outboxPollIntervalMs());
  }

  private async publishPendingOutbox(version: string): Promise<void> {
    if (this.publishingOutbox) {
      return;
    }

    this.publishingOutbox = true;
    try {
      const rows = await this.claimOutboxRows();

      for (const row of rows) {
        await this.publishOutboxRow(row, version);
      }
    } catch (error) {
      this.logger.error('fulfillment_outbox_publish_failed', {
        business_error_code: 'FULFILLMENT_OUTBOX_FAILED',
        result: 'FULFILLMENT_OUTBOX_FAILED',
        error_message: error instanceof Error ? error.message : 'unknown error',
      });
    } finally {
      await this.recordOutboxBacklogDepth(version);
      this.publishingOutbox = false;
    }
  }

  private async recordOutboxBacklogDepth(version: string): Promise<void> {
    try {
      const result = await this.db().query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM event_outbox
         WHERE status <> 'PUBLISHED'`,
      );
      this.metrics.recordEventBacklogDepth(
        'event_outbox',
        version,
        Number(result.rows[0]?.count ?? 0),
      );
    } catch {
      // Metrics must not affect fulfillment processing.
    }
  }

  private async claimOutboxRows(): Promise<OutboxRow[]> {
    const result = await this.db().query<OutboxRow>(
      `UPDATE event_outbox
       SET status = 'IN_PROGRESS',
           attempt_count = attempt_count + 1,
           updated_at = NOW()
       WHERE outbox_id IN (
         SELECT outbox_id
         FROM event_outbox
         WHERE status = 'PENDING'
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING outbox_id, event_name, queue_name, queue_url, payload, attempt_count`,
      [this.outboxBatchSize()],
    );

    return result.rows;
  }

  private async publishOutboxRow(
    row: OutboxRow,
    version: string,
  ): Promise<void> {
    try {
      await this.client().send(
        new SendMessageCommand({
          QueueUrl: row.queue_url,
          MessageBody: JSON.stringify(row.payload),
        }),
      );
      await this.db().query(
        `UPDATE event_outbox
         SET status = 'PUBLISHED', published_at = NOW(), updated_at = NOW()
         WHERE outbox_id = $1`,
        [row.outbox_id],
      );
      this.metrics.recordSqsPublish('success', version, row.queue_name);
    } catch (error) {
      await this.db().query(
        `UPDATE event_outbox
         SET status = 'PENDING', last_error = $2, updated_at = NOW()
         WHERE outbox_id = $1`,
        [
          row.outbox_id,
          error instanceof Error ? error.message : 'unknown error',
        ],
      );
      this.metrics.recordSqsPublish('failure', version, row.queue_name);
      this.logger.error('fulfillment_outbox_event_publish_failed', {
        event_id: row.payload.event_id,
        event_name: row.event_name,
        correlation_id: row.payload.correlation_id,
        queue: row.queue_name,
        detail: `attempt:${row.attempt_count}`,
        business_error_code: 'FULFILLMENT_EVENT_QUEUE_FAILED',
        result: 'FULFILLMENT_EVENT_QUEUE_FAILED',
        error_message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  private async resetInterruptedOutboxRows(): Promise<void> {
    await this.db().query(
      `UPDATE event_outbox
       SET status = 'PENDING', updated_at = NOW()
       WHERE status = 'IN_PROGRESS'`,
    );
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
        const response = await this.client().send(
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
          this.logger.error('fulfillment_worker_poll_failed', {
            queue: this.inputQueueName(),
            business_error_code: 'FULFILLMENT_WORKER_POLL_FAILED',
            result: 'FULFILLMENT_WORKER_POLL_FAILED',
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

    if (!isOrderConfirmedEvent(event)) {
      await this.deleteMessage(message.ReceiptHandle);
      return;
    }

    try {
      await this.handleOrderConfirmed({
        event,
        requestId: message.MessageId ?? event.event_id,
      });
      await this.deleteMessage(message.ReceiptHandle);
      this.logger.info('fulfillment_worker_message_processed', {
        event_id: event.event_id,
        event_name: event.event_name,
        correlation_id: event.correlation_id,
        order_id: event.payload.order_id,
        payment_id: event.payload.payment_id,
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

    await this.client().send(
      new DeleteMessageCommand({
        QueueUrl: this.inputQueueUrl(),
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private async evaluatePromiseMode(): Promise<PromiseMode> {
    if (!this.promesaExpressEnabled()) {
      return {
        fulfillmentModel: 'standard',
        status: 'FULFILLMENT_COMMITTED',
        estimatedDeliveryDate: deliveryDate(3),
        promesaExpressFailed: false,
      };
    }

    const latencyMs = this.promesaExpressLatencyMs();
    if (latencyMs > 0) {
      await sleep(latencyMs);
    }

    if (this.promesaExpressFails()) {
      return {
        fulfillmentModel: 'standard',
        status: 'FULFILLMENT_AT_RISK',
        estimatedDeliveryDate: deliveryDate(5),
        reason: 'PROMESA_EXPRESS_UNAVAILABLE',
        promesaExpressFailed: true,
      };
    }

    return {
      fulfillmentModel: 'promesa_express',
      status: 'FULFILLMENT_COMMITTED',
      estimatedDeliveryDate: deliveryDate(1),
      promesaExpressFailed: false,
    };
  }

  private async ensureSchema(): Promise<void> {
    await this.db().query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        seller_sku TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL,
        available_quantity INTEGER NOT NULL,
        reserved_quantity INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);
    await this.db().query(`
      CREATE TABLE IF NOT EXISTS inventory_reservations (
        reservation_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        seller_sku TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        UNIQUE (order_id, seller_sku)
      )
    `);
    await this.db().query(`
      CREATE TABLE IF NOT EXISTS fulfillment_commitments (
        commitment_id TEXT PRIMARY KEY,
        order_id TEXT UNIQUE NOT NULL,
        seller_id TEXT NOT NULL,
        fulfillment_model TEXT NOT NULL,
        origin_type TEXT NOT NULL,
        estimated_delivery_date DATE,
        status TEXT NOT NULL,
        reserved_items JSONB NOT NULL,
        failed_items JSONB NOT NULL DEFAULT '[]'::jsonb,
        reason TEXT,
        committed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);
    await this.db().query(`
      CREATE TABLE IF NOT EXISTS fulfillment_state_transitions (
        transition_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        commitment_id TEXT NOT NULL,
        status_from TEXT NOT NULL,
        status_to TEXT NOT NULL,
        causation_id TEXT NOT NULL,
        changed_at TIMESTAMPTZ NOT NULL
      )
    `);
    await this.db().query(`
      CREATE TABLE IF NOT EXISTS event_outbox (
        outbox_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        event_name TEXT NOT NULL,
        queue_name TEXT NOT NULL,
        queue_url TEXT NOT NULL,
        payload JSONB NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        published_at TIMESTAMPTZ
      )
    `);
    await this.db().query(`
      CREATE INDEX IF NOT EXISTS event_outbox_pending_idx
        ON event_outbox (status, created_at)
    `);
    await this.seedInventory();
  }

  private async seedInventory(): Promise<void> {
    const now = new Date().toISOString();
    await this.db().query(
      `INSERT INTO inventory_items (
         seller_sku, seller_id, available_quantity, reserved_quantity, updated_at
       ) VALUES
         ('MATE-STANLEY-NO-OFICIAL', 'seller_445566', 1, 0, $1),
         ('CARPINCHO-USB-C', 'seller_445566', 100, 0, $1),
         ('TECLADO-MECANICO-RUIDOSO', 'seller_445566', 100, 0, $1)
       ON CONFLICT (seller_sku) DO NOTHING`,
      [now],
    );
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
      'postgresql://fulfillment:fulfillment@localhost:15433/fulfillment_planning',
    );
  }

  private client(): SQSClient {
    if (!this.sqsClient) {
      this.sqsClient = new SQSClient({
        region: this.config.get<string>('AWS_REGION', 'us-east-1'),
        endpoint: this.endpoint(),
        credentials: this.credentials(),
      });
    }

    return this.sqsClient;
  }

  private inputQueueUrl(): string {
    return this.config.get<string>(
      'INPUT_SQS_QUEUE_URL',
      'http://localhost:4566/000000000000/orders-confirmed-intake',
    );
  }

  private outputQueueUrl(): string {
    return this.config.get<string>(
      'SQS_QUEUE_URL',
      'http://localhost:4566/000000000000/fulfillment-commitment-intake',
    );
  }

  private inputQueueName(): string {
    return this.inputQueueUrl().split('/').pop() ?? 'orders-confirmed-intake';
  }

  private outputQueueName(): string {
    return (
      this.outputQueueUrl().split('/').pop() ?? 'fulfillment-commitment-intake'
    );
  }

  private trackingQueueUrl(): string | undefined {
    return this.config.get<string>('TRACKING_SQS_QUEUE_URL');
  }

  private trackingQueueName(): string {
    return this.trackingQueueUrl()?.split('/').pop() ?? 'buyer-tracking-events';
  }

  private inventoryQueueUrl(): string {
    return this.config.get<string>(
      'INVENTORY_SQS_QUEUE_URL',
      this.outputQueueUrl(),
    );
  }

  private inventoryQueueName(): string {
    return this.inventoryQueueUrl().split('/').pop() ?? this.outputQueueName();
  }

  private endpoint(): string | undefined {
    const endpoint =
      this.config.get<string>('SQS_ENDPOINT') ??
      this.config.get<string>('AWS_ENDPOINT_URL');

    if (endpoint) {
      return endpoint;
    }

    return [
      this.inputQueueUrl(),
      this.outputQueueUrl(),
      this.trackingQueueUrl(),
      this.inventoryQueueUrl(),
    ].some((queueUrl) => queueUrl?.startsWith('http://localhost:4566'))
      ? 'http://localhost:4566'
      : undefined;
  }

  private credentials():
    | { accessKeyId: string; secretAccessKey: string }
    | undefined {
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');

    if (accessKeyId && secretAccessKey) {
      return { accessKeyId, secretAccessKey };
    }

    if (this.endpoint()) {
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

  private promesaExpressEnabled(): boolean {
    return (
      this.config.get<string>('PROMESA_EXPRESS_ENABLED', 'false') === 'true'
    );
  }

  private promesaExpressLatencyMs(): number {
    const value = Number(
      this.config.get<string>('PROMESA_EXPRESS_LATENCY_MS', '0'),
    );
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  private promesaExpressFails(): boolean {
    const value = Number(
      this.config.get<string>('PROMESA_EXPRESS_ERROR_RATE', '0'),
    );

    if (!Number.isFinite(value) || value <= 0) {
      return false;
    }

    if (value >= 1) {
      return true;
    }

    return Math.random() < value;
  }

  private outboxBatchSize(): number {
    const value = Number(this.config.get<string>('OUTBOX_BATCH_SIZE', '10'));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 10;
  }

  private outboxPollIntervalMs(): number {
    const value = Number(
      this.config.get<string>('OUTBOX_POLL_INTERVAL_MS', '1000'),
    );
    return Number.isFinite(value) && value >= 100 ? Math.floor(value) : 1000;
  }
}

class FulfillmentEventPublishError extends Error {
  constructor(readonly cause: unknown) {
    super('fulfillment event could not be published');
  }
}

function commitmentSelectSql(): string {
  return `SELECT commitment_id, order_id, seller_id, fulfillment_model, origin_type,
                 estimated_delivery_date, status, reserved_items, failed_items, reason,
                 committed_at, created_at, updated_at
          FROM fulfillment_commitments
          WHERE order_id = $1`;
}

function unavailableItems(
  items: OrderConfirmedItemDto[],
  inventory: Map<string, InventoryItemRecord>,
): FailedItemRecord[] {
  const failed: FailedItemRecord[] = [];

  for (const item of aggregateItems(items)) {
    const inventoryItem = inventory.get(item.seller_sku);
    const availableQuantity = inventoryItem?.available_quantity ?? 0;

    if (availableQuantity < item.quantity) {
      failed.push({
        seller_sku: item.seller_sku,
        requested_quantity: item.quantity,
        available_quantity: availableQuantity,
      });
    }
  }

  return failed;
}

function aggregateItems(
  items: OrderConfirmedItemDto[],
): OrderConfirmedItemDto[] {
  const quantities = new Map<string, OrderConfirmedItemDto>();

  for (const item of items) {
    const current = quantities.get(item.seller_sku);

    if (current) {
      current.quantity += item.quantity;
    } else {
      quantities.set(item.seller_sku, { ...item });
    }
  }

  return Array.from(quantities.values());
}

function sellerSkus(items: OrderConfirmedItemDto[]): string[] {
  return Array.from(new Set(items.map((item) => item.seller_sku)));
}

function toCommitment(row: CommitmentRow): FulfillmentCommitmentRecord {
  return {
    fulfillment_commitment_id: row.commitment_id,
    order_id: row.order_id,
    seller_id: row.seller_id,
    fulfillment_model: row.fulfillment_model,
    origin_type: row.origin_type,
    estimated_delivery_date: row.estimated_delivery_date,
    status: row.status,
    reserved_items: row.reserved_items,
    failed_items: row.failed_items,
    reason: row.reason,
    committed_at: row.committed_at ? isoString(row.committed_at) : undefined,
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  };
}

function toInventoryItem(row: InventoryRow): InventoryItemRecord {
  return {
    seller_sku: row.seller_sku,
    seller_id: row.seller_id,
    available_quantity: Number(row.available_quantity),
    reserved_quantity: Number(row.reserved_quantity),
    updated_at: isoString(row.updated_at),
  };
}

function response(
  commitment: FulfillmentCommitmentRecord,
  duplicate: boolean,
  version: string,
): FulfillmentAcceptedResponse {
  return {
    order_id: commitment.order_id,
    fulfillment_commitment_id: commitment.fulfillment_commitment_id,
    status: commitment.status,
    duplicate,
    version,
    reason: commitment.reason,
  };
}

function metricStatusFor(
  status: FulfillmentStatus,
): 'committed' | 'commitment_failed' | 'commitment_at_risk' {
  if (status === 'FULFILLMENT_FAILED') {
    return 'commitment_failed';
  }

  if (status === 'FULFILLMENT_AT_RISK') {
    return 'commitment_at_risk';
  }

  return 'committed';
}

function logEventFor(status: FulfillmentStatus): string {
  if (status === 'FULFILLMENT_FAILED') {
    return 'fulfillment_commitment_failed';
  }

  if (status === 'FULFILLMENT_AT_RISK') {
    return 'fulfillment_commitment_at_risk';
  }

  return 'fulfillment_commitment_confirmed';
}

function processingFailureCode(error: unknown): string {
  if (error instanceof FulfillmentEventPublishError) {
    return 'FULFILLMENT_EVENT_QUEUE_FAILED';
  }

  if (isPgUniqueViolation(error)) {
    return 'FULFILLMENT_IDEMPOTENCY_CONFLICT';
  }

  return 'FULFILLMENT_PERSISTENCE_FAILED';
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

function isOrderConfirmedEvent(
  value: unknown,
): value is OrderConfirmedEventDto {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { event_name?: unknown }).event_name ===
      'orders.order_confirmed.v1' &&
    typeof (value as { event_id?: unknown }).event_id === 'string' &&
    typeof (value as { correlation_id?: unknown }).correlation_id ===
      'string' &&
    typeof (value as { payload?: { order_id?: unknown } }).payload?.order_id ===
      'string'
  );
}

function deliveryDate(daysFromNow: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

function deliveryPromiseDurationSeconds(event: OrderConfirmedEventDto): number {
  const confirmedAt =
    validIsoOrUndefined(event.payload.confirmed_at) ?? event.occurred_at;
  const confirmedAtMs = Date.parse(confirmedAt);

  if (!Number.isFinite(confirmedAtMs)) {
    return 0;
  }

  return Math.max(0, (Date.now() - confirmedAtMs) / 1000);
}

function validIsoOrUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return Number.isFinite(Date.parse(value)) ? value : undefined;
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
