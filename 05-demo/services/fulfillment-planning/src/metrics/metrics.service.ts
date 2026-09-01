import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

type FulfillmentStatus =
  | 'committed'
  | 'commitment_failed'
  | 'commitment_at_risk'
  | 'duplicate_event_ignored'
  | 'processing_failed';
type SqsStatus = 'success' | 'failure';

@Injectable()
export class MetricsService {
  private readonly serviceName = 'fulfillment-planning';
  private readonly registry = new Registry();
  private readonly httpRequests: Counter<string>;
  private readonly httpDuration: Histogram<string>;
  private readonly commitments: Counter<string>;
  private readonly commitmentDuration: Histogram<string>;
  private readonly deliveryPromiseWithin15s: Gauge<string>;
  private readonly confirmedOrdersWithoutStockShortageCancellation: Gauge<string>;
  private readonly deliveryPromiseStability: Gauge<string>;
  private readonly sqsPublish: Counter<string>;
  private readonly eventBacklogDepth: Gauge<string>;
  private readonly eventDlqDepth: Gauge<string>;
  private readonly promesaExpressFailures: Counter<string>;
  private readonly buildInfo: Gauge<string>;
  private deliveryPromiseEligible = 0;
  private deliveryPromiseGood = 0;
  private stockShortageCancellationEligible = 0;
  private stockShortageCancellationGood = 0;
  private deliveryPromiseStabilityEligible = 0;
  private deliveryPromiseStabilityGood = 0;

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
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15],
      registers: [this.registry],
    });
    this.commitments = new Counter({
      name: 'fulfillment_commitments_total',
      help: 'Total fulfillment-planning outcomes',
      labelNames: ['service', 'status', 'version'],
      registers: [this.registry],
    });
    this.commitmentDuration = new Histogram({
      name: 'fulfillment_commitment_duration_seconds',
      help: 'Fulfillment commitment processing duration in seconds',
      labelNames: ['service', 'status', 'version'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15],
      registers: [this.registry],
    });
    this.deliveryPromiseWithin15s = new Gauge({
      name: 'delivery_promise_created_within_15s_ratio',
      help: 'Ratio of confirmed orders receiving a delivery promise within 15 seconds',
      labelNames: ['service', 'version'],
      registers: [this.registry],
    });
    this.confirmedOrdersWithoutStockShortageCancellation = new Gauge({
      name: 'confirmed_orders_without_stock_shortage_cancellation_ratio',
      help: 'Ratio of confirmed orders that did not fail fulfillment because of stock shortage',
      labelNames: ['service', 'version'],
      registers: [this.registry],
    });
    this.deliveryPromiseStability = new Gauge({
      name: 'delivery_promise_stability_ratio',
      help: 'Source-side ratio of created delivery promises that remain stable in fulfillment-planning',
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
    this.promesaExpressFailures = new Counter({
      name: 'promesa_express_failures_total',
      help: 'Total Promesa Express failures degraded to at-risk commitments',
      labelNames: ['service', 'version'],
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

  recordFulfillment(status: FulfillmentStatus, version: string): void {
    this.commitments.inc({ service: this.serviceName, status, version });
  }

  observeCommitmentDuration(
    status: FulfillmentStatus,
    version: string,
    durationSeconds: number,
  ): void {
    this.commitmentDuration.observe(
      { service: this.serviceName, status, version },
      durationSeconds,
    );
  }

  recordPromesaExpressFailure(version: string): void {
    this.promesaExpressFailures.inc({ service: this.serviceName, version });
  }

  recordDeliveryPromiseSlo(
    version: string,
    durationSeconds: number,
    promiseCreated: boolean,
  ): void {
    this.deliveryPromiseEligible += 1;

    if (promiseCreated && durationSeconds < 15) {
      this.deliveryPromiseGood += 1;
    }

    this.deliveryPromiseWithin15s.set(
      { service: this.serviceName, version },
      this.deliveryPromiseGood / this.deliveryPromiseEligible,
    );
  }

  recordStockShortageCancellationSlo(
    version: string,
    avoidedStockShortageCancellation: boolean,
  ): void {
    this.stockShortageCancellationEligible += 1;

    if (avoidedStockShortageCancellation) {
      this.stockShortageCancellationGood += 1;
    }

    this.confirmedOrdersWithoutStockShortageCancellation.set(
      { service: this.serviceName, version },
      this.stockShortageCancellationGood /
        this.stockShortageCancellationEligible,
    );
  }

  recordDeliveryPromiseStability(version: string, stable: boolean): void {
    this.deliveryPromiseStabilityEligible += 1;

    if (stable) {
      this.deliveryPromiseStabilityGood += 1;
    }

    this.deliveryPromiseStability.set(
      { service: this.serviceName, version },
      this.deliveryPromiseStabilityGood / this.deliveryPromiseStabilityEligible,
    );
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
      'http://localhost:4566/000000000000/fulfillment-commitment-intake',
    );

    return queueUrl.split('/').pop() ?? 'fulfillment-commitment-intake';
  }
}
