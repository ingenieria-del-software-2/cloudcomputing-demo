import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

type TrackingStatus =
  | 'updated'
  | 'duplicate_event_ignored'
  | 'unsupported_event_ignored'
  | 'processing_failed';
type SqsStatus = 'success' | 'failure';
type DynamoDbStatus = 'success' | 'failure';

@Injectable()
export class MetricsService {
  private readonly serviceName = 'buyer-order-tracking';
  private readonly registry = new Registry();
  private readonly httpRequests: Counter<string>;
  private readonly httpDuration: Histogram<string>;
  private readonly trackingEvents: Counter<string>;
  private readonly trackingDuration: Histogram<string>;
  private readonly freshness: Histogram<string>;
  private readonly freshnessP95: Gauge<string>;
  private readonly freshnessUnder60Ratio: Gauge<string>;
  private readonly criticalJourneyDuration: Histogram<string>;
  private readonly criticalJourneyUnder60Ratio: Gauge<string>;
  private readonly dynamodbDuration: Histogram<string>;
  private readonly sqsConsume: Counter<string>;
  private readonly sqsPublish: Counter<string>;
  private readonly eventBacklogDepth: Gauge<string>;
  private readonly eventDlqDepth: Gauge<string>;
  private readonly buildInfo: Gauge<string>;
  private freshnessTotal = 0;
  private freshnessUnder60 = 0;
  private criticalJourneyTotal = 0;
  private criticalJourneyUnder60 = 0;
  private readonly freshnessSamplesByVersion = new Map<string, number[]>();

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
    this.trackingEvents = new Counter({
      name: 'buyer_tracking_events_total',
      help: 'Total buyer-order-tracking event processing outcomes',
      labelNames: ['service', 'status', 'event_name', 'version'],
      registers: [this.registry],
    });
    this.trackingDuration = new Histogram({
      name: 'buyer_tracking_update_duration_seconds',
      help: 'Buyer tracking update processing duration in seconds',
      labelNames: ['service', 'status', 'version'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
    this.freshness = new Histogram({
      name: 'buyer_tracking_freshness_seconds',
      help: 'Delay between source event occurrence and buyer-visible tracking update',
      labelNames: ['service', 'event_name', 'visible_status', 'version'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
      registers: [this.registry],
    });
    this.freshnessP95 = new Gauge({
      name: 'buyer_tracking_freshness_p95',
      help: 'In-memory p95 of buyer tracking freshness for local war room evidence',
      labelNames: ['service', 'version'],
      registers: [this.registry],
    });
    this.freshnessUnder60Ratio = new Gauge({
      name: 'buyer_tracking_freshness_under_60s_ratio',
      help: 'Ratio of buyer tracking updates reflected in under 60 seconds',
      labelNames: ['service', 'version'],
      registers: [this.registry],
    });
    this.criticalJourneyDuration = new Histogram({
      name: 'critical_order_journey_duration_seconds',
      help: 'End-to-end payment approval to terminal buyer-visible tracking duration',
      labelNames: ['service', 'visible_status', 'version'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
      registers: [this.registry],
    });
    this.criticalJourneyUnder60Ratio = new Gauge({
      name: 'critical_order_journey_under_60s_ratio',
      help: 'Ratio of critical order journeys reaching terminal buyer-visible state under 60 seconds',
      labelNames: ['service', 'version'],
      registers: [this.registry],
    });
    this.dynamodbDuration = new Histogram({
      name: 'dynamodb_request_duration_seconds',
      help: 'DynamoDB request latency for buyer tracking read/write operations',
      labelNames: ['service', 'operation', 'status', 'table', 'version'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    this.sqsConsume = new Counter({
      name: 'sqs_consume_total',
      help: 'Total SQS consume attempts',
      labelNames: ['service', 'queue', 'status', 'version'],
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
      help: 'Approximate number of events waiting in the service queue',
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

  recordTrackingEvent(
    status: TrackingStatus,
    eventName: string,
    version: string,
  ): void {
    this.trackingEvents.inc({
      service: this.serviceName,
      status,
      event_name: eventName,
      version,
    });
  }

  observeTrackingDuration(
    status: TrackingStatus,
    version: string,
    durationSeconds: number,
  ): void {
    this.trackingDuration.observe(
      { service: this.serviceName, status, version },
      durationSeconds,
    );
  }

  observeFreshness(labels: {
    eventName: string;
    visibleStatus: string;
    version: string;
    freshnessSeconds: number;
  }): void {
    this.freshness.observe(
      {
        service: this.serviceName,
        event_name: labels.eventName,
        visible_status: labels.visibleStatus,
        version: labels.version,
      },
      labels.freshnessSeconds,
    );
    this.freshnessTotal += 1;
    if (labels.freshnessSeconds < 60) {
      this.freshnessUnder60 += 1;
    }
    this.freshnessUnder60Ratio.set(
      { service: this.serviceName, version: labels.version },
      this.freshnessUnder60 / this.freshnessTotal,
    );
    this.freshnessP95.set(
      { service: this.serviceName, version: labels.version },
      this.recordFreshnessSample(labels.version, labels.freshnessSeconds),
    );
  }

  observeDynamoDbDuration(labels: {
    operation: string;
    status: DynamoDbStatus;
    table: string;
    version: string;
    durationSeconds: number;
  }): void {
    this.dynamodbDuration.observe(
      {
        service: this.serviceName,
        operation: labels.operation,
        status: labels.status,
        table: labels.table,
        version: labels.version,
      },
      labels.durationSeconds,
    );
  }

  observeCriticalJourney(labels: {
    visibleStatus: string;
    version: string;
    durationSeconds: number;
  }): void {
    this.criticalJourneyDuration.observe(
      {
        service: this.serviceName,
        visible_status: labels.visibleStatus,
        version: labels.version,
      },
      labels.durationSeconds,
    );
    this.criticalJourneyTotal += 1;
    if (labels.durationSeconds < 60) {
      this.criticalJourneyUnder60 += 1;
    }
    this.criticalJourneyUnder60Ratio.set(
      { service: this.serviceName, version: labels.version },
      this.criticalJourneyUnder60 / this.criticalJourneyTotal,
    );
  }

  recordSqsConsume(
    status: SqsStatus,
    version: string,
    queue = this.inputQueueName(),
  ): void {
    this.sqsConsume.inc({
      service: this.serviceName,
      queue,
      status,
      version,
    });
  }

  recordSqsPublish(
    status: SqsStatus,
    version: string,
    queue = this.outputQueueName(),
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

  private inputQueueName(): string {
    const queueUrl = this.config.get<string>(
      'INPUT_SQS_QUEUE_URL',
      'http://localhost:4566/000000000000/buyer-tracking-events',
    );

    return queueUrl.split('/').pop() ?? 'buyer-tracking-events';
  }

  private outputQueueName(): string {
    const queueUrl = this.config.get<string>(
      'SQS_QUEUE_URL',
      'http://localhost:4566/000000000000/customer-experience-events',
    );

    return queueUrl.split('/').pop() ?? 'customer-experience-events';
  }

  private recordFreshnessSample(
    version: string,
    freshnessSeconds: number,
  ): number {
    const samples = this.freshnessSamplesByVersion.get(version) ?? [];
    samples.push(freshnessSeconds);

    if (samples.length > 1024) {
      samples.shift();
    }

    this.freshnessSamplesByVersion.set(version, samples);
    return percentile(samples, 0.95);
  }
}

function percentile(samples: number[], quantile: number): number {
  if (samples.length === 0) {
    return 0;
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.ceil(sorted.length * quantile) - 1;

  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}
