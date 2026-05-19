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
  | 'duplicate_payment_ignored'
  | 'accepted'
  | 'replayed'
  | 'invalid'
  | 'idempotency_conflict'
  | 'ledger_failed'
  | 'queue_failed'
  | 'injected_failure';
type LedgerStatus = 'attempt' | 'success' | 'failure';
type SqsStatus = 'success' | 'failure';

@Injectable()
export class MetricsService {
  private readonly serviceName = 'order-management';
  private readonly registry = new Registry();
  private readonly httpRequests: Counter<string>;
  private readonly httpDuration: Histogram<string>;
  private readonly orders: Counter<string>;
  private readonly ledgerRequests: Counter<string>;
  private readonly sqsPublish: Counter<string>;
  private readonly buildInfo: Gauge<string>;

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
    this.ledgerRequests = new Counter({
      name: 'ledger_client_requests_total',
      help: 'Total ledger client requests',
      labelNames: ['service', 'status', 'version'],
      registers: [this.registry],
    });
    this.sqsPublish = new Counter({
      name: 'sqs_publish_total',
      help: 'Total SQS publish attempts',
      labelNames: ['service', 'queue', 'status', 'version'],
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

  recordTransaction(status: OrderStatus, version: string): void {
    this.recordOrder(status, version);
  }

  recordLedgerRequest(status: LedgerStatus, version: string): void {
    this.ledgerRequests.inc({ service: this.serviceName, status, version });
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
