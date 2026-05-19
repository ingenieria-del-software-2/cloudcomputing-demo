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

@Injectable()
export class MetricsService {
  private readonly serviceName = 'shipment-preparation';
  private readonly registry = new Registry();
  private readonly httpRequests: Counter<string>;
  private readonly httpDuration: Histogram<string>;
  private readonly shipments: Counter<string>;
  private readonly shipmentDuration: Histogram<string>;
  private readonly documentFailures: Counter<string>;
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
      'http://localhost:4566/000000000000/buyer-tracking-events',
    );

    return queueUrl.split('/').pop() ?? 'buyer-tracking-events';
  }
}
