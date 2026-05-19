import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Pool, type QueryResultRow } from 'pg';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  PaymentApprovedDto,
  PaymentApprovedItemDto,
} from './payment-approved.dto';

type OrderStatus = 'ORDER_CONFIRMED';

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

interface OrderCreateResult {
  order: OrderRecord;
  duplicate: boolean;
}

export interface OrderAcceptedResponse {
  order_id: string;
  payment_id: string;
  status: 'ORDER_CONFIRMED' | 'DUPLICATE_PAYMENT_IGNORED';
  duplicate: boolean;
  version: string;
}

@Injectable()
export class OrderService implements OnModuleInit, OnModuleDestroy {
  private pool?: Pool;
  private sqsClient?: SQSClient;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
    this.sqsClient?.destroy();
  }

  async approvePayment(
    command: ApprovePaymentCommand,
  ): Promise<OrderAcceptedResponse> {
    const startedAt = performance.now();
    const version = this.config.get<string>('SERVICE_VERSION', 'v1');

    try {
      const result = await this.createOrReplayOrder(command.body);

      if (result.duplicate) {
        return await this.acceptDuplicate(
          command,
          result.order,
          version,
          startedAt,
        );
      }

      return await this.confirmOrder(command, result.order, version, startedAt);
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
    version: string,
    startedAt: number,
  ): Promise<OrderAcceptedResponse> {
    const event = this.orderConfirmedEvent(order, command);
    await this.publish(event, version);
    this.metrics.recordOrder('confirmed', version);
    this.logger.info('order_confirmed', {
      request_id: command.requestId,
      event_id: event.event_id,
      event_name: event.event_name,
      correlation_id: event.correlation_id,
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
    body: PaymentApprovedDto,
  ): Promise<OrderCreateResult> {
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

    const result = await this.db().query<OrderRow>(insertSql, [
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
      return { order: toRecord(result.rows[0]), duplicate: false };
    }

    const existing = await this.findIdempotentByPaymentId(body.payment_id);
    if (!existing) {
      throw new Error('duplicate payment record was not found after conflict');
    }

    return { order: existing, duplicate: true };
  }

  private async findIdempotentByPaymentId(
    paymentId: string,
  ): Promise<OrderRecord | undefined> {
    const result = await this.db().query<OrderRow>(
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
        confirmed_at: occurredAt,
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

  private endpoint(): string | undefined {
    const endpoint =
      this.config.get<string>('SQS_ENDPOINT') ??
      this.config.get<string>('AWS_ENDPOINT_URL');

    if (endpoint) {
      return endpoint;
    }

    return this.queueUrl().startsWith('http://localhost:4566')
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

function confirmationFailureCode(error: unknown): string {
  if (error instanceof OrderEventPublishError) {
    return 'ORDER_EVENT_QUEUE_FAILED';
  }

  if (isPgUniqueViolation(error)) {
    return 'DUPLICATE_PAYMENT_CONFLICT';
  }

  return 'ORDER_PERSISTENCE_FAILED';
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

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
