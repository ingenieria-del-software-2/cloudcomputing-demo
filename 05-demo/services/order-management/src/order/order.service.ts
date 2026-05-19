import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import { MetricsService } from '../metrics/metrics.service';
import { PaymentApprovedDto } from './payment-approved.dto';

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
  items: PaymentApprovedDto['items'];
  created_at: string;
  updated_at: string;
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

export interface OrderAcceptedResponse {
  order_id: string;
  payment_id: string;
  status: 'ORDER_CONFIRMED' | 'DUPLICATE_PAYMENT_IGNORED';
  duplicate: boolean;
  version: string;
}

@Injectable()
export class OrderService {
  private readonly ordersById = new Map<string, OrderRecord>();
  private readonly orderIdByPaymentId = new Map<string, string>();
  private sqsClient?: SQSClient;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async approvePayment(command: {
    body: PaymentApprovedDto;
    requestId: string;
    correlationId?: string;
  }): Promise<OrderAcceptedResponse> {
    const existing = this.findByPaymentId(command.body.payment_id);
    const version = this.config.get<string>('SERVICE_VERSION', 'v1');

    if (existing && this.idempotencyEnabled()) {
      const event = this.duplicateIgnoredEvent(existing, command);
      await this.publish(event, version);
      this.metrics.recordOrder('duplicate_payment_ignored', version);
      this.logger.info('duplicate_payment_ignored', {
        request_id: command.requestId,
        event_id: event.event_id,
        event_name: event.event_name,
        correlation_id: event.correlation_id,
        order_id: existing.order_id,
        payment_id: existing.payment_id,
      });

      return {
        order_id: existing.order_id,
        payment_id: existing.payment_id,
        status: 'DUPLICATE_PAYMENT_IGNORED',
        duplicate: true,
        version,
      };
    }

    const order = this.createOrder(command.body);
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
    });

    return {
      order_id: order.order_id,
      payment_id: order.payment_id,
      status: 'ORDER_CONFIRMED',
      duplicate: false,
      version,
    };
  }

  findByOrderId(orderId: string): OrderRecord | undefined {
    return this.ordersById.get(orderId);
  }

  private createOrder(body: PaymentApprovedDto): OrderRecord {
    const now = new Date().toISOString();
    const order: OrderRecord = {
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

    this.ordersById.set(order.order_id, order);
    this.orderIdByPaymentId.set(order.payment_id, order.order_id);
    return order;
  }

  private findByPaymentId(paymentId: string): OrderRecord | undefined {
    const orderId = this.orderIdByPaymentId.get(paymentId);
    return orderId ? this.ordersById.get(orderId) : undefined;
  }

  private orderConfirmedEvent(
    order: OrderRecord,
    command: {
      body: PaymentApprovedDto;
      requestId: string;
      correlationId?: string;
    },
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
    command: {
      body: PaymentApprovedDto;
      requestId: string;
      correlationId?: string;
    },
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
      this.metrics.recordOrder('queue_failed', version);
      this.logger.error('order_event_publish_failed', {
        event_id: event.event_id,
        event_name: event.event_name,
        correlation_id: event.correlation_id,
        order_id: stringValue(event.payload.order_id),
        payment_id: stringValue(event.payload.payment_id),
        error_message: error instanceof Error ? error.message : 'unknown error',
      });
      throw new ServiceUnavailableException({
        status: 503,
        code: 'ORDER_EVENT_QUEUE_FAILED',
        message:
          'Order could not be accepted because the order event was not queued',
      });
    }
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

function correlationId(command: {
  body: PaymentApprovedDto;
  correlationId?: string;
}): string {
  const explicit = command.correlationId?.trim();
  return explicit && explicit.length > 0
    ? explicit
    : `checkout_${hash(command.body.cart_id).slice(0, 12)}`;
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
