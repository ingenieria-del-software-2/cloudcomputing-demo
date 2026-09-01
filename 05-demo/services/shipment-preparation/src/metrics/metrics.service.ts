import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

type ShipmentStatus =
  | 'ready_to_dispatch'
  | 'dispatch_blocked'
  | 'duplicate_event_ignored'
  | 'processing_failed';
type SqsStatus = 'success' | 'failure';
type S3Status = 'success' | 'failure';

@Injectable()
export class MetricsService {
  private readonly serviceName = 'shipment-preparation';
  private readonly registry = new Registry();
  private readonly httpRequests: Counter<string>;
  private readonly httpDuration: Histogram<string>;
  private readonly shipments: Counter<string>;
  private readonly shipmentDuration: Histogram<string>;
  private readonly documentFailures: Counter<string>;
  private readonly dispatchDocumentFailureCount: Counter<string>;
  private readonly readyBeforeCutoff: Gauge<string>;
  private readonly documentAvailabilityOnAccess: Gauge<string>;
  private readonly s3PutObject: Counter<string>;
  private readonly sqsPublish: Counter<string>;
  private readonly eventBacklogDepth: Gauge<string>;
  private readonly eventDlqDepth: Gauge<string>;
  private readonly buildInfo: Gauge<string>;
  private documentAvailabilityEligible = 0;
  private documentAvailabilityGood = 0;

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
    this.shipments = new Counter({
      name: 'shipments_total',
      help: 'Total shipment-preparation outcomes',
      labelNames: ['service', 'status', 'version'],
      registers: [this.registry],
    });
    this.shipmentDuration = new Histogram({
      name: 'shipment_preparation_duration_seconds',
      help: 'Shipment preparation processing duration in seconds',
      labelNames: ['service', 'status', 'version'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
    this.documentFailures = new Counter({
      name: 'shipment_document_failures_total',
      help: 'Total shipment document generation or upload failures',
      labelNames: ['service', 'version'],
      registers: [this.registry],
    });
    this.dispatchDocumentFailureCount = new Counter({
      name: 'dispatch_document_failure_count',
      help: 'Total dispatch document failures for war room evidence',
      labelNames: ['service', 'version'],
      registers: [this.registry],
    });
    this.readyBeforeCutoff = new Gauge({
      name: 'ready_to_dispatch_before_seller_cutoff_ratio',
      help: 'Whether the latest eligible shipment was ready before seller cutoff',
      labelNames: ['service', 'version'],
      registers: [this.registry],
    });
    this.documentAvailabilityOnAccess = new Gauge({
      name: 'dispatch_document_availability_on_first_access_ratio',
      help: 'Ratio of shipments whose dispatch documents were available on first access',
      labelNames: ['service', 'version'],
      registers: [this.registry],
    });
    this.s3PutObject = new Counter({
      name: 's3_put_object_total',
      help: 'Total local S3 PutObject outcomes for shipment documents',
      labelNames: ['service', 'bucket', 'status', 'reason', 'version'],
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

  recordShipment(status: ShipmentStatus, version: string): void {
    this.shipments.inc({ service: this.serviceName, status, version });
  }

  observeShipmentDuration(
    status: ShipmentStatus,
    version: string,
    durationSeconds: number,
  ): void {
    this.shipmentDuration.observe(
      { service: this.serviceName, status, version },
      durationSeconds,
    );
  }

  recordDocumentFailure(version: string): void {
    this.documentFailures.inc({ service: this.serviceName, version });
    this.dispatchDocumentFailureCount.inc({
      service: this.serviceName,
      version,
    });
  }

  recordReadyBeforeCutoff(version: string, readyBeforeCutoff: boolean): void {
    this.readyBeforeCutoff.set(
      { service: this.serviceName, version },
      readyBeforeCutoff ? 1 : 0,
    );
  }

  recordDocumentAvailabilityOnAccess(
    version: string,
    availableOnAccess: boolean,
  ): void {
    this.documentAvailabilityEligible += 1;

    if (availableOnAccess) {
      this.documentAvailabilityGood += 1;
    }

    this.documentAvailabilityOnAccess.set(
      { service: this.serviceName, version },
      this.documentAvailabilityGood / this.documentAvailabilityEligible,
    );
  }

  recordS3PutObject(labels: {
    bucket: string;
    status: S3Status;
    reason: string;
    version: string;
  }): void {
    this.s3PutObject.inc({
      service: this.serviceName,
      bucket: labels.bucket,
      status: labels.status,
      reason: labels.reason,
      version: labels.version,
    });
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
      'http://localhost:4566/000000000000/buyer-tracking-events',
    );

    return queueUrl.split('/').pop() ?? 'buyer-tracking-events';
  }
}
