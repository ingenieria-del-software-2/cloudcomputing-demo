import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

type OrderStatus =
  | 'confirmed'
  | 'cancelled'
  | 'duplicate_payment_ignored'
  | 'confirmation_failed'
  | 'cancellation_failed'
  | 'accepted'
  | 'replayed'
  | 'invalid'
  | 'idempotency_conflict'
  | 'queue_failed'
  | 'injected_failure';
type SqsStatus = 'success' | 'failure';

@Injectable()
export class MetricsService {
  private readonly serviceName = 'order-management';
  private readonly registry = new Registry();
  private readonly httpRequests: Counter<string>;
  private readonly httpDuration: Histogram<string>;
  private readonly orders: Counter<string>;
  private readonly duplicateOrderAttempts: Counter<string>;
  private readonly orderConfirmationWithin5s: Gauge<string>;
  private readonly sqsPublish: Counter<string>;
  private readonly eventBacklogDepth: Gauge<string>;
  private readonly eventDlqDepth: Gauge<string>;
  private readonly buildInfo: Gauge<string>;
  private orderConfirmationEligible = 0;
  private orderConfirmationGood = 0;

  constructor(private readonly config: ConfigService = new ConfigService()) {
    collectDefaultMetrics({
      register: this.registry,
      labels: {
        service: this.serviceName,
      },
    });

    this.httpRequests = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['service', 'route', 'method', 'status', 'version'],
      registers: [this.registry],
    });
    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['service', 'route', 'method', 'status', 'version'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    this.orders = new Counter({
      name: 'orders_total',
      help: 'Total order-management outcomes',
      labelNames: ['service', 'status', 'version'],
      registers: [this.registry],
    });
    this.duplicateOrderAttempts = new Counter({
      name: 'duplicate_order_attempts_total',
      help: 'Total duplicate payment attempts ignored by order-management',
      labelNames: ['service', 'version'],
      registers: [this.registry],
    });
    this.orderConfirmationWithin5s = new Gauge({
      name: 'order_confirmation_within_5s_ratio',
      help: 'Ratio of valid approved payments confirmed as orders within 5 seconds',
      labelNames: ['service', 'version'],
      registers: [this.registry],
    });
    this.sqsPublish = new Counter({
      name: 'sqs_publish_total',
      help: 'Total SQS publish attempts',
      labelNames: ['service', 'queue', 'status', 'version'],
      registers: [this.registry],
    });
    this.eventBacklogDepth = new Gauge({
      name: 'event_backlog_depth',
      help: 'Approximate number of events waiting in the service queue or outbox',
      labelNames: ['service', 'queue', 'version'],
      registers: [this.registry],
    });
    this.eventDlqDepth = new Gauge({
      name: 'event_dlq_depth',
      help: 'Approximate number of events waiting in the service dead-letter queue',
      labelNames: ['service', 'queue', 'version'],
      registers: [this.registry],
    });
    this.buildInfo = new Gauge({
      name: 'build_info',
      help: 'Build and version metadata',
      labelNames: ['service', 'version', 'commit'],
      registers: [this.registry],
    });
  }

  recordHttpRequest(labels: {
    route: string;
    method: string;
    status: string;
    version: string;
    durationSeconds: number;
  }): void {
    const metricLabels = {
      service: this.serviceName,
      route: labels.route,
      method: labels.method,
      status: labels.status,
      version: labels.version,
    };
    this.httpRequests.inc(metricLabels);
    this.httpDuration.observe(metricLabels, labels.durationSeconds);
  }

  recordOrder(status: OrderStatus, version: string): void {
    this.orders.inc({ service: this.serviceName, status, version });
  }

  recordDuplicateOrderAttempt(version: string): void {
    this.duplicateOrderAttempts.inc({ service: this.serviceName, version });
  }

  recordOrderConfirmationSlo(
    version: string,
    durationSeconds: number,
    confirmed: boolean,
  ): void {
    this.orderConfirmationEligible += 1;

    if (confirmed && durationSeconds < 5) {
      this.orderConfirmationGood += 1;
    }

    this.orderConfirmationWithin5s.set(
      { service: this.serviceName, version },
      this.orderConfirmationGood / this.orderConfirmationEligible,
    );
  }

  recordTransaction(status: OrderStatus, version: string): void {
    this.recordOrder(status, version);
  }

  recordSqsPublish(
    status: SqsStatus,
    version: string,
    queue = this.queueName(),
  ): void {
    this.sqsPublish.inc({
      service: this.serviceName,
      queue,
      status,
      version,
    });
  }

  recordEventBacklogDepth(queue: string, version: string, depth: number): void {
    this.eventBacklogDepth.set(
      { service: this.serviceName, queue, version },
      depth,
    );
  }

  recordEventDlqDepth(queue: string, version: string, depth: number): void {
    this.eventDlqDepth.set(
      { service: this.serviceName, queue, version },
      depth,
    );
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    this.buildInfo.set(
      {
        service: this.serviceName,
        version: this.config.get<string>('SERVICE_VERSION', 'v1'),
        commit: this.config.get<string>('GIT_COMMIT', 'local'),
      },
      1,
    );

    return this.registry.metrics();
  }

  private queueName(): string {
    const queueUrl = this.config.get<string>(
      'SQS_QUEUE_URL',
      'http://localhost:4566/000000000000/orders-confirmed-intake',
    );

    return queueUrl.split('/').pop() ?? 'orders-confirmed-intake';
  }
}
