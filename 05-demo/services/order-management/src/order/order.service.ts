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
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import { MetricsService } from '../metrics/metrics.service';
import { FulfillmentFailedEventDto } from './fulfillment-failed-event.dto';
import {
  PaymentApprovedDto,
  PaymentApprovedItemDto,
} from './payment-approved.dto';

type OrderStatus = 'ORDER_CONFIRMED' | 'ORDER_CANCELLED';

export interface OrderRecord {
  order_id: string;
  payment_id: string;
  buyer_id: string;
  seller_id: string;
  site_id: string;
  currency: string;
  gross_amount: number;
  status: OrderStatus;
  items: PaymentApprovedItemDto[];
  created_at: string;
  updated_at: string;
}

interface OrderRow extends QueryResultRow {
  order_id: string;
  payment_id: string;
  buyer_id: string;
  seller_id: string;
  site_id: string;
  currency: string;
  gross_amount: string | number;
  status: OrderStatus;
  items: PaymentApprovedItemDto[];
  created_at: Date | string;
  updated_at: Date | string;
}

interface EventEnvelope<TPayload> {
  event_id: string;
  event_name: string;
  event_version: '1.0';
  occurred_at: string;
  producer: 'order-management';
  correlation_id: string;
  causation_id: string;
  idempotency_key: string;
  payload: TPayload;
}

interface ApprovePaymentCommand {
  body: PaymentApprovedDto;
  requestId: string;
  correlationId?: string;
}

interface CancelAfterFulfillmentFailedCommand {
  event: FulfillmentFailedEventDto;
  requestId: string;
}

interface OrderCreateResult {
  order: OrderRecord;
  duplicate: boolean;
  event?: EventEnvelope<Record<string, unknown>>;
}

interface OrderCancellationResult {
  order: OrderRecord;
  duplicate: boolean;
  event?: EventEnvelope<Record<string, unknown>>;
  previousStatus?: OrderStatus;
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

export interface OrderAcceptedResponse {
  order_id: string;
  payment_id: string;
  status: 'ORDER_CONFIRMED' | 'DUPLICATE_PAYMENT_IGNORED';
  duplicate: boolean;
  version: string;
}

export interface OrderCancellationResponse {
  order_id: string;
  payment_id: string;
  status: 'ORDER_CANCELLED' | 'ORDER_ALREADY_CANCELLED';
  duplicate: boolean;
  version: string;
  reason?: string;
}

@Injectable()
export class OrderService implements OnModuleInit, OnModuleDestroy {
  private pool?: Pool;
  private sqsClient?: SQSClient;
  private outboxTimer?: NodeJS.Timeout;
  private publishingOutbox = false;
  private stopping = false;
  private paymentWorkers: Promise<void>[] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
    await this.resetInterruptedOutboxRows();
    this.startOutboxPublisher();
    this.startPaymentIntakeWorkers();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.outboxTimer) {
      clearInterval(this.outboxTimer);
    }
    await Promise.allSettled(this.paymentWorkers);
    await this.pool?.end();
    this.sqsClient?.destroy();
  }

  async approvePayment(
    command: ApprovePaymentCommand,
  ): Promise<OrderAcceptedResponse> {
    const startedAt = performance.now();
    const version = this.config.get<string>('SERVICE_VERSION', 'v1');

    try {
      const result = await this.createOrReplayOrder(command);

      if (result.duplicate) {
        return await this.acceptDuplicate(
          command,
          result.order,
          version,
          startedAt,
        );
      }

      return await this.confirmOrder(
        command,
        result.order,
        result.event,
        version,
        startedAt,
      );
    } catch (error) {
      await this.failConfirmation(command, version, startedAt, error);
      throw new ServiceUnavailableException({
        status: 503,
        code: 'ORDER_CONFIRMATION_FAILED',
        message: 'Order could not be confirmed',
      });
    }
  }

  async findByOrderId(orderId: string): Promise<OrderRecord | undefined> {
    const result = await this.db().query<OrderRow>(
      `SELECT order_id, payment_id, buyer_id, seller_id, site_id, currency,
              gross_amount, status, items, created_at, updated_at
       FROM orders
       WHERE order_id = $1`,
      [orderId],
    );

    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async cancelAfterFulfillmentFailed(
    command: CancelAfterFulfillmentFailedCommand,
  ): Promise<OrderCancellationResponse> {
    const startedAt = performance.now();
    const version = this.config.get<string>('SERVICE_VERSION', 'v1');

    try {
      const result = await this.cancelOrder(command);

      if (!result.duplicate) {
        await this.publishPendingOutbox(version);
      }

      this.metrics.recordOrder('cancelled', version);
      this.logger.info('order_cancelled_after_fulfillment_failed', {
        request_id: command.requestId,
        event_id: result.event?.event_id ?? command.event.event_id,
        event_name: result.event?.event_name ?? command.event.event_name,
        correlation_id: command.event.correlation_id,
        order_id: result.order.order_id,
        payment_id: result.order.payment_id,
        status_before: result.previousStatus ?? result.order.status,
        status_after: result.order.status,
        business_error_code: cancellationReason(command.event),
        duration_ms: durationMs(startedAt),
        result: result.duplicate
          ? 'ORDER_ALREADY_CANCELLED'
          : 'ORDER_CANCELLED',
      });

      return {
        order_id: result.order.order_id,
        payment_id: result.order.payment_id,
        status: result.duplicate
          ? 'ORDER_ALREADY_CANCELLED'
          : 'ORDER_CANCELLED',
        duplicate: result.duplicate,
        version,
        reason: cancellationReason(command.event),
      };
    } catch (error) {
      this.metrics.recordOrder('cancellation_failed', version);
      this.logger.error('order_cancellation_failed', {
        request_id: command.requestId,
        event_id: command.event.event_id,
        event_name: command.event.event_name,
        correlation_id: command.event.correlation_id,
        order_id: command.event.payload.order_id,
        status_before: 'ORDER_CONFIRMED',
        status_after: 'ORDER_CANCELLATION_FAILED',
        business_error_code: cancellationFailureCode(error),
        duration_ms: durationMs(startedAt),
        result: 'ORDER_CANCELLATION_FAILED',
        error_message: error instanceof Error ? error.message : 'unknown error',
      });
      throw new ServiceUnavailableException({
        status: 503,
        code: 'ORDER_CANCELLATION_FAILED',
        message: 'Order could not be cancelled',
      });
    }
  }

  private async acceptDuplicate(
    command: ApprovePaymentCommand,
    order: OrderRecord,
    version: string,
    startedAt: number,
  ): Promise<OrderAcceptedResponse> {
    const event = this.duplicateIgnoredEvent(order, command);
    await this.publish(event, version);
    this.metrics.recordOrder('duplicate_payment_ignored', version);
    this.metrics.recordDuplicateOrderAttempt(version);
    this.logger.info('duplicate_payment_ignored', {
      request_id: command.requestId,
      event_id: event.event_id,
      event_name: event.event_name,
      correlation_id: event.correlation_id,
      order_id: order.order_id,
      payment_id: order.payment_id,
      status_before: 'ORDER_CONFIRMED',
      status_after: 'ORDER_CONFIRMED',
      duration_ms: durationMs(startedAt),
      result: 'DUPLICATE_PAYMENT_IGNORED',
    });

    return {
      order_id: order.order_id,
      payment_id: order.payment_id,
      status: 'DUPLICATE_PAYMENT_IGNORED',
      duplicate: true,
      version,
    };
  }

  private async confirmOrder(
    command: ApprovePaymentCommand,
    order: OrderRecord,
    event: EventEnvelope<Record<string, unknown>> | undefined,
    version: string,
    startedAt: number,
  ): Promise<OrderAcceptedResponse> {
    await this.publishPendingOutbox(version);
    this.metrics.recordOrder('confirmed', version);
    this.metrics.recordOrderConfirmationSlo(
      version,
      confirmationDurationSeconds(command.body, startedAt),
      true,
    );
    this.logger.info('order_confirmed', {
      request_id: command.requestId,
      event_id: event?.event_id,
      event_name: event?.event_name,
      correlation_id: event?.correlation_id ?? correlationId(command),
      order_id: order.order_id,
      payment_id: order.payment_id,
      status_before: 'PAYMENT_APPROVED_RECEIVED',
      status_after: 'ORDER_CONFIRMED',
      duration_ms: durationMs(startedAt),
      result: 'ORDER_CONFIRMED',
    });

    return {
      order_id: order.order_id,
      payment_id: order.payment_id,
      status: 'ORDER_CONFIRMED',
      duplicate: false,
      version,
    };
  }

  private async failConfirmation(
    command: ApprovePaymentCommand,
    version: string,
    startedAt: number,
    error: unknown,
  ): Promise<void> {
    const businessErrorCode = confirmationFailureCode(error);
    const event = this.orderConfirmationFailedEvent(command, businessErrorCode);
    this.metrics.recordOrder('confirmation_failed', version);
    this.metrics.recordOrderConfirmationSlo(
      version,
      confirmationDurationSeconds(command.body, startedAt),
      false,
    );
    await this.publishFailureEvent(event, version);
    this.logger.error('order_confirmation_failed', {
      request_id: command.requestId,
      event_id: event.event_id,
      event_name: event.event_name,
      correlation_id: event.correlation_id,
      payment_id: command.body.payment_id,
      status_before: 'PAYMENT_APPROVED_RECEIVED',
      status_after: 'ORDER_CONFIRMATION_FAILED',
      business_error_code: businessErrorCode,
      duration_ms: durationMs(startedAt),
      result: 'ORDER_CONFIRMATION_FAILED',
      error_message: error instanceof Error ? error.message : 'unknown error',
    });
  }

  private async createOrReplayOrder(
    command: ApprovePaymentCommand,
  ): Promise<OrderCreateResult> {
    const body = command.body;
    const order = newOrderRecord(body);
    const idempotencyEnabled = this.idempotencyEnabled();
    const insertSql = idempotencyEnabled
      ? `INSERT INTO orders (
           order_id, payment_id, idempotency_enabled, buyer_id, seller_id,
           site_id, currency, gross_amount, status, items, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
         ON CONFLICT (payment_id) WHERE idempotency_enabled DO NOTHING
         RETURNING order_id, payment_id, buyer_id, seller_id, site_id, currency,
                   gross_amount, status, items, created_at, updated_at`
      : `INSERT INTO orders (
           order_id, payment_id, idempotency_enabled, buyer_id, seller_id,
           site_id, currency, gross_amount, status, items, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
         RETURNING order_id, payment_id, buyer_id, seller_id, site_id, currency,
                   gross_amount, status, items, created_at, updated_at`;

    const client = await this.db().connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<OrderRow>(insertSql, [
        order.order_id,
        order.payment_id,
        idempotencyEnabled,
        order.buyer_id,
        order.seller_id,
        order.site_id,
        order.currency,
        order.gross_amount,
        order.status,
        JSON.stringify(order.items),
        order.created_at,
        order.updated_at,
      ]);

      if (result.rows[0]) {
        const created = toRecord(result.rows[0]);
        await this.insertOrderItems(client, created);
        await this.insertOrderTransition(client, {
          order: created,
          statusFrom: 'PAYMENT_APPROVED_RECEIVED',
          causationId: command.requestId,
          changedAt: created.created_at,
        });
        const event = this.orderConfirmedEvent(created, command);
        await this.insertOutboxEvents(
          client,
          this.outboxEventsFor(event),
          created.created_at,
        );
        await client.query('COMMIT');
        return { order: created, duplicate: false, event };
      }

      const existing = await this.findIdempotentByPaymentId(
        body.payment_id,
        client,
      );
      if (!existing) {
        throw new Error(
          'duplicate payment record was not found after conflict',
        );
      }

      await client.query('COMMIT');
      return { order: existing, duplicate: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async cancelOrder(
    command: CancelAfterFulfillmentFailedCommand,
  ): Promise<OrderCancellationResult> {
    const client = await this.db().connect();

    try {
      await client.query('BEGIN');
      const existing = await this.findByOrderIdForUpdate(
        command.event.payload.order_id,
        client,
      );

      if (!existing) {
        throw new Error('order was not found for cancellation');
      }

      if (existing.status === 'ORDER_CANCELLED') {
        await client.query('COMMIT');
        return { order: existing, duplicate: true };
      }

      const cancelledAt = new Date().toISOString();
      const cancelled = await this.updateOrderStatus(
        client,
        existing.order_id,
        'ORDER_CANCELLED',
        cancelledAt,
      );
      await this.insertOrderTransition(client, {
        order: cancelled,
        statusFrom: existing.status,
        causationId: command.event.event_id,
        changedAt: cancelledAt,
      });
      const event = this.orderCancelledEvent(
        cancelled,
        command.event,
        cancelledAt,
      );
      await this.insertOutboxEvents(
        client,
        this.outboxEventsFor(event),
        cancelledAt,
      );
      await client.query('COMMIT');

      return {
        order: cancelled,
        duplicate: false,
        event,
        previousStatus: existing.status,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async findByOrderIdForUpdate(
    orderId: string,
    client: PoolClient,
  ): Promise<OrderRecord | undefined> {
    const result = await client.query<OrderRow>(
      `SELECT order_id, payment_id, buyer_id, seller_id, site_id, currency,
              gross_amount, status, items, created_at, updated_at
       FROM orders
       WHERE order_id = $1
       FOR UPDATE`,
      [orderId],
    );

    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  private async updateOrderStatus(
    client: PoolClient,
    orderId: string,
    status: OrderStatus,
    updatedAt: string,
  ): Promise<OrderRecord> {
    const result = await client.query<OrderRow>(
      `UPDATE orders
       SET status = $2, updated_at = $3
       WHERE order_id = $1
       RETURNING order_id, payment_id, buyer_id, seller_id, site_id, currency,
                 gross_amount, status, items, created_at, updated_at`,
      [orderId, status, updatedAt],
    );

    return toRecord(result.rows[0]);
  }

  private async findIdempotentByPaymentId(
    paymentId: string,
    client: PoolClient | Pool = this.db(),
  ): Promise<OrderRecord | undefined> {
    const result = await client.query<OrderRow>(
      `SELECT order_id, payment_id, buyer_id, seller_id, site_id, currency,
              gross_amount, status, items, created_at, updated_at
       FROM orders
       WHERE payment_id = $1
         AND idempotency_enabled = true
       ORDER BY created_at ASC
       LIMIT 1`,
      [paymentId],
    );

    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  private async insertOrderItems(
    client: PoolClient,
    order: OrderRecord,
  ): Promise<void> {
    for (const [index, item] of order.items.entries()) {
      await client.query(
        `INSERT INTO order_items (
           order_id, line_number, item_id, seller_sku, quantity, unit_price, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (order_id, line_number) DO NOTHING`,
        [
          order.order_id,
          index + 1,
          item.item_id,
          item.seller_sku,
          item.quantity,
          item.unit_price,
          order.created_at,
        ],
      );
    }
  }

  private async insertOrderTransition(
    client: PoolClient,
    input: {
      order: OrderRecord;
      statusFrom: string;
      causationId: string;
      changedAt: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO order_state_transitions (
         transition_id, order_id, status_from, status_to, causation_id, changed_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        newId('trn'),
        input.order.order_id,
        input.statusFrom,
        input.order.status,
        input.causationId,
        input.changedAt,
      ],
    );
  }

  private outboxEventsFor(
    event: EventEnvelope<Record<string, unknown>>,
  ): OutboxEvent[] {
    const events: OutboxEvent[] = [
      {
        event,
        queueName: this.queueName(),
        queueUrl: this.queueUrl(),
      },
    ];
    const trackingQueueUrl = this.trackingQueueUrl();

    if (trackingQueueUrl) {
      events.push({
        event,
        queueName: this.trackingQueueName(),
        queueUrl: trackingQueueUrl,
      });
    }

    return events;
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

  private orderConfirmedEvent(
    order: OrderRecord,
    command: ApprovePaymentCommand,
  ): EventEnvelope<Record<string, unknown>> {
    const occurredAt = new Date().toISOString();

    return {
      event_id: newId('evt'),
      event_name: 'orders.order_confirmed.v1',
      event_version: '1.0',
      occurred_at: occurredAt,
      producer: 'order-management',
      correlation_id: correlationId(command),
      causation_id: command.requestId,
      idempotency_key: `payment_id:${order.payment_id}`,
      payload: {
        order_id: order.order_id,
        payment_id: order.payment_id,
        buyer_id: order.buyer_id,
        seller_id: order.seller_id,
        site_id: order.site_id,
        currency: order.currency,
        gross_amount: order.gross_amount,
        items: order.items,
        payment_approved_at: paymentApprovedAt(command.body),
        confirmed_at: occurredAt,
      },
    };
  }

  private orderCancelledEvent(
    order: OrderRecord,
    source: FulfillmentFailedEventDto,
    cancelledAt: string,
  ): EventEnvelope<Record<string, unknown>> {
    return {
      event_id: newId('evt'),
      event_name: 'orders.order_cancelled.v1',
      event_version: '1.0',
      occurred_at: cancelledAt,
      producer: 'order-management',
      correlation_id: source.correlation_id,
      causation_id: source.event_id,
      idempotency_key: `order_id:${order.order_id}:cancellation`,
      payload: {
        order_id: order.order_id,
        payment_id: order.payment_id,
        buyer_id: order.buyer_id,
        seller_id: order.seller_id,
        reason: cancellationReason(source),
        source_event_name: source.event_name,
        payment_approved_at: stringValue(source.payload.payment_approved_at),
        cancelled_at: cancelledAt,
      },
    };
  }

  private duplicateIgnoredEvent(
    order: OrderRecord,
    command: ApprovePaymentCommand,
  ): EventEnvelope<Record<string, unknown>> {
    const occurredAt = new Date().toISOString();

    return {
      event_id: newId('evt'),
      event_name: 'orders.duplicate_payment_ignored.v1',
      event_version: '1.0',
      occurred_at: occurredAt,
      producer: 'order-management',
      correlation_id: correlationId(command),
      causation_id: command.requestId,
      idempotency_key: `payment_id:${order.payment_id}`,
      payload: {
        order_id: order.order_id,
        payment_id: order.payment_id,
        ignored_at: occurredAt,
      },
    };
  }

  private orderConfirmationFailedEvent(
    command: ApprovePaymentCommand,
    businessErrorCode: string,
  ): EventEnvelope<Record<string, unknown>> {
    const occurredAt = new Date().toISOString();

    return {
      event_id: newId('evt'),
      event_name: 'orders.order_confirmation_failed.v1',
      event_version: '1.0',
      occurred_at: occurredAt,
      producer: 'order-management',
      correlation_id: correlationId(command),
      causation_id: command.requestId,
      idempotency_key: `payment_id:${command.body.payment_id}`,
      payload: {
        payment_id: command.body.payment_id,
        cart_id: command.body.cart_id,
        buyer_id: command.body.buyer_id,
        seller_id: command.body.seller_id,
        business_error_code: businessErrorCode,
        failed_at: occurredAt,
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
          QueueUrl: this.queueUrl(),
          MessageBody: JSON.stringify(event),
        }),
      );
      this.metrics.recordSqsPublish('success', version, this.queueName());
    } catch (error) {
      this.metrics.recordSqsPublish('failure', version, this.queueName());
      this.logger.error('order_event_publish_failed', {
        event_id: event.event_id,
        event_name: event.event_name,
        correlation_id: event.correlation_id,
        order_id: stringValue(event.payload.order_id),
        payment_id: stringValue(event.payload.payment_id),
        business_error_code: 'ORDER_EVENT_QUEUE_FAILED',
        result: 'ORDER_EVENT_QUEUE_FAILED',
        error_message: error instanceof Error ? error.message : 'unknown error',
      });
      throw new OrderEventPublishError(error);
    }
  }

  private async publishFailureEvent(
    event: EventEnvelope<Record<string, unknown>>,
    version: string,
  ): Promise<void> {
    try {
      await this.publish(event, version);
    } catch {
      // The HTTP response still reports the failed order confirmation.
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
      this.logger.error('order_tracking_event_publish_failed', {
        event_id: event.event_id,
        event_name: event.event_name,
        correlation_id: event.correlation_id,
        order_id: stringValue(event.payload.order_id),
        payment_id: stringValue(event.payload.payment_id),
        business_error_code: 'ORDER_TRACKING_QUEUE_FAILED',
        result: 'ORDER_TRACKING_QUEUE_FAILED',
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
      this.logger.error('order_outbox_publish_failed', {
        business_error_code: 'ORDER_OUTBOX_FAILED',
        result: 'ORDER_OUTBOX_FAILED',
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
      // Metrics must not affect order confirmation.
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
      this.logger.error('order_outbox_event_publish_failed', {
        event_id: row.payload.event_id,
        event_name: row.event_name,
        correlation_id: row.payload.correlation_id,
        queue: row.queue_name,
        detail: `attempt:${row.attempt_count}`,
        business_error_code: 'ORDER_EVENT_QUEUE_FAILED',
        result: 'ORDER_EVENT_QUEUE_FAILED',
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

  private startPaymentIntakeWorkers(): void {
    if (!this.paymentIntakeConsumerEnabled()) {
      return;
    }

    for (
      let index = 0;
      index < this.paymentIntakeWorkerConcurrency();
      index += 1
    ) {
      this.paymentWorkers.push(this.paymentIntakeWorkerLoop(index));
    }
  }

  private async paymentIntakeWorkerLoop(workerIndex: number): Promise<void> {
    while (!this.stopping) {
      try {
        const response = await this.client().send(
          new ReceiveMessageCommand({
            QueueUrl: this.paymentIntakeQueueUrl(),
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: this.waitTimeSeconds(),
          }),
        );

        for (const message of response.Messages ?? []) {
          await this.processPaymentMessage(workerIndex, message);
        }
      } catch (error) {
        if (!this.stopping) {
          this.logger.error('payment_intake_worker_poll_failed', {
            queue: this.paymentIntakeQueueName(),
            business_error_code: 'PAYMENT_INTAKE_WORKER_POLL_FAILED',
            result: 'PAYMENT_INTAKE_WORKER_POLL_FAILED',
            error_message:
              error instanceof Error ? error.message : 'unknown error',
          });
          await sleep(250);
        }
      }
    }
  }

  private async processPaymentMessage(
    workerIndex: number,
    message: { Body?: string; MessageId?: string; ReceiptHandle?: string },
  ): Promise<void> {
    const parsed = parsePaymentApprovedMessage(message.Body);

    if (!parsed) {
      await this.deletePaymentMessage(message.ReceiptHandle);
      return;
    }

    try {
      await this.approvePayment({
        body: parsed.body,
        correlationId: parsed.correlationId,
        requestId: parsed.requestId,
      });
      await this.deletePaymentMessage(message.ReceiptHandle);
      this.logger.info('payment_intake_message_processed', {
        event_id: parsed.requestId,
        event_name: 'payments.payment_approved.v1',
        correlation_id: parsed.correlationId,
        payment_id: parsed.body.payment_id,
        queue: this.paymentIntakeQueueName(),
        result: 'MESSAGE_PROCESSED',
        detail: `worker:${workerIndex}`,
      });
    } catch {
      // Leave the message in SQS so the queue redrive policy can move it to DLQ.
    }
  }

  private async deletePaymentMessage(
    receiptHandle: string | undefined,
  ): Promise<void> {
    if (!receiptHandle) {
      return;
    }

    await this.client().send(
      new DeleteMessageCommand({
        QueueUrl: this.paymentIntakeQueueUrl(),
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private async ensureSchema(): Promise<void> {
    await this.db().query(`
      CREATE TABLE IF NOT EXISTS orders (
        order_id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL,
        idempotency_enabled BOOLEAN NOT NULL DEFAULT true,
        buyer_id TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        currency TEXT NOT NULL,
        gross_amount NUMERIC(12,2) NOT NULL,
        status TEXT NOT NULL,
        items JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);
    await this.db().query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS idempotency_enabled BOOLEAN NOT NULL DEFAULT true
    `);
    await this.db().query(`
      ALTER TABLE orders
        DROP CONSTRAINT IF EXISTS orders_payment_id_key
    `);
    await this.db().query(`
      CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_id_idempotent_unique
        ON orders (payment_id)
        WHERE idempotency_enabled
    `);
    await this.db().query(`
      CREATE TABLE IF NOT EXISTS order_items (
        order_id TEXT NOT NULL REFERENCES orders(order_id),
        line_number INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        seller_sku TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price NUMERIC(12,2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (order_id, line_number)
      )
    `);
    await this.db().query(`
      CREATE TABLE IF NOT EXISTS order_state_transitions (
        transition_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(order_id),
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
      'postgresql://order:order@localhost:15432/order_management',
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

  private queueUrl(): string {
    return this.config.get<string>(
      'SQS_QUEUE_URL',
      'http://localhost:4566/000000000000/orders-confirmed-intake',
    );
  }

  private queueName(): string {
    return this.queueUrl().split('/').pop() ?? 'orders-confirmed-intake';
  }

  private trackingQueueUrl(): string | undefined {
    return this.config.get<string>('TRACKING_SQS_QUEUE_URL');
  }

  private trackingQueueName(): string {
    return this.trackingQueueUrl()?.split('/').pop() ?? 'buyer-tracking-events';
  }

  private paymentIntakeQueueUrl(): string {
    return (
      this.config.get<string>('PAYMENT_INTAKE_SQS_QUEUE_URL') ??
      this.config.get<string>('PAYMENTS_APPROVED_SQS_QUEUE_URL') ??
      'http://localhost:4566/000000000000/payments-approved-intake'
    );
  }

  private paymentIntakeQueueName(): string {
    return (
      this.paymentIntakeQueueUrl().split('/').pop() ??
      'payments-approved-intake'
    );
  }

  private endpoint(): string | undefined {
    const endpoint =
      this.config.get<string>('SQS_ENDPOINT') ??
      this.config.get<string>('AWS_ENDPOINT_URL');

    if (endpoint) {
      return endpoint;
    }

    return [
      this.queueUrl(),
      this.trackingQueueUrl(),
      this.paymentIntakeConsumerEnabled()
        ? this.paymentIntakeQueueUrl()
        : undefined,
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

  private idempotencyEnabled(): boolean {
    return this.config.get<string>('IDEMPOTENCY_ENABLED', 'true') !== 'false';
  }

  private paymentIntakeConsumerEnabled(): boolean {
    return (
      this.config.get<string>('PAYMENT_INTAKE_CONSUMER_ENABLED', 'false') ===
        'true' ||
      this.config.get<string>('PAYMENTS_APPROVED_CONSUMER_ENABLED', 'false') ===
        'true'
    );
  }

  private paymentIntakeWorkerConcurrency(): number {
    const value = Number(
      this.config.get<string>('PAYMENT_INTAKE_WORKER_CONCURRENCY', '1'),
    );
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
  }

  private waitTimeSeconds(): number {
    const value = Number(this.config.get<string>('SQS_WAIT_TIME_SECONDS', '1'));
    return Number.isFinite(value) && value >= 0 && value <= 20
      ? Math.floor(value)
      : 1;
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

class OrderEventPublishError extends Error {
  constructor(readonly cause: unknown) {
    super('order event could not be published');
  }
}

function newOrderRecord(body: PaymentApprovedDto): OrderRecord {
  const now = new Date().toISOString();

  return {
    order_id: newId('ord'),
    payment_id: body.payment_id,
    buyer_id: body.buyer_id,
    seller_id: body.seller_id,
    site_id: body.site_id,
    currency: body.currency,
    gross_amount: body.gross_amount,
    status: 'ORDER_CONFIRMED',
    items: body.items,
    created_at: now,
    updated_at: now,
  };
}

function toRecord(row: OrderRow): OrderRecord {
  return {
    order_id: row.order_id,
    payment_id: row.payment_id,
    buyer_id: row.buyer_id,
    seller_id: row.seller_id,
    site_id: row.site_id,
    currency: row.currency,
    gross_amount: Number(row.gross_amount),
    status: row.status,
    items: row.items,
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  };
}

function correlationId(command: {
  body: PaymentApprovedDto;
  correlationId?: string;
}): string {
  const explicit = command.correlationId?.trim();
  return explicit && explicit.length > 0
    ? explicit
    : `checkout_${hash(command.body.cart_id).slice(0, 12)}`;
}

function paymentApprovedAt(body: PaymentApprovedDto): string {
  return (
    validIsoOrUndefined(body.payment_approved_at) ?? new Date().toISOString()
  );
}

function confirmationDurationSeconds(
  body: PaymentApprovedDto,
  startedAt: number,
): number {
  const approvedAt = validIsoOrUndefined(body.payment_approved_at);

  if (!approvedAt) {
    return Math.max(0, performance.now() - startedAt) / 1000;
  }

  return Math.max(0, (Date.now() - Date.parse(approvedAt)) / 1000);
}

function validIsoOrUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function cancellationReason(event: FulfillmentFailedEventDto): string {
  return stringValue(event.payload.reason) ?? 'FULFILLMENT_COMMITMENT_FAILED';
}

function confirmationFailureCode(error: unknown): string {
  if (error instanceof OrderEventPublishError) {
    return 'ORDER_EVENT_QUEUE_FAILED';
  }

  if (isPgUniqueViolation(error)) {
    return 'DUPLICATE_PAYMENT_CONFLICT';
  }

  return 'ORDER_PERSISTENCE_FAILED';
}

function cancellationFailureCode(error: unknown): string {
  if (error instanceof OrderEventPublishError) {
    return 'ORDER_EVENT_QUEUE_FAILED';
  }

  return 'ORDER_CANCELLATION_PERSISTENCE_FAILED';
}

function parsePaymentApprovedMessage(
  body: string | undefined,
):
  | { body: PaymentApprovedDto; correlationId: string; requestId: string }
  | undefined {
  if (!body) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(body) as unknown;

    if (isPaymentApprovedEnvelope(parsed)) {
      return {
        body: parsed.payload,
        correlationId: parsed.correlation_id,
        requestId: parsed.event_id,
      };
    }

    if (isPaymentApprovedPayload(parsed)) {
      return {
        body: parsed,
        correlationId: `checkout_${hash(parsed.cart_id).slice(0, 12)}`,
        requestId: `evt_${hash(parsed.payment_id).slice(0, 16)}`,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isPaymentApprovedEnvelope(value: unknown): value is {
  event_id: string;
  event_name: 'payments.payment_approved.v1';
  correlation_id: string;
  payload: PaymentApprovedDto;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.event_name === 'payments.payment_approved.v1' &&
    typeof candidate.event_id === 'string' &&
    typeof candidate.correlation_id === 'string' &&
    isPaymentApprovedPayload(candidate.payload)
  );
}

function isPaymentApprovedPayload(value: unknown): value is PaymentApprovedDto {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<PaymentApprovedDto>;
  return (
    typeof candidate.payment_id === 'string' &&
    typeof candidate.cart_id === 'string' &&
    typeof candidate.buyer_id === 'string' &&
    typeof candidate.seller_id === 'string' &&
    typeof candidate.site_id === 'string' &&
    typeof candidate.currency === 'string' &&
    typeof candidate.gross_amount === 'number' &&
    Array.isArray(candidate.items) &&
    candidate.items.length > 0
  );
}

function isPgUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function durationMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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
