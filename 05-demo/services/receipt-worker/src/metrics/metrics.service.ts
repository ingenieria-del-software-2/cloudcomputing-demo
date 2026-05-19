import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

type SqsConsumeStatus = 'success' | 'empty' | 'failure' | 'invalid';
type SqsDeleteStatus = 'success' | 'failure';
type ReceiptStatus = 'success' | 'duplicate' | 'invalid' | 'failure';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly httpRequests: Counter<string>;
  private readonly httpDuration: Histogram<string>;
  private readonly sqsConsume: Counter<string>;
  private readonly sqsDelete: Counter<string>;
  private readonly receiptsProcessed: Counter<string>;
  private readonly buildInfo: Gauge<string>;

  constructor(private readonly config: ConfigService = new ConfigService()) {
    collectDefaultMetrics({
      register: this.registry,
      labels: {
        service: 'receipt-worker',
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
    this.sqsConsume = new Counter({
      name: 'sqs_consume_total',
      help: 'Total receipt queue consume outcomes',
      labelNames: ['service', 'queue', 'status', 'version'],
      registers: [this.registry],
    });
    this.sqsDelete = new Counter({
      name: 'sqs_delete_total',
      help: 'Total receipt queue delete outcomes',
      labelNames: ['service', 'queue', 'status', 'version'],
      registers: [this.registry],
    });
    this.receiptsProcessed = new Counter({
      name: 'receipt_processed_total',
      help: 'Total processed receipt outcomes',
      labelNames: ['service', 'status', 'version'],
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
      service: 'receipt-worker',
      route: labels.route,
      method: labels.method,
      status: labels.status,
      version: labels.version,
    };
    this.httpRequests.inc(metricLabels);
    this.httpDuration.observe(metricLabels, labels.durationSeconds);
  }

  recordSqsConsume(status: SqsConsumeStatus, version = this.version()): void {
    this.sqsConsume.inc({
      service: 'receipt-worker',
      queue: 'receipt-commands',
      status,
      version,
    });
  }

  recordSqsDelete(status: SqsDeleteStatus, version = this.version()): void {
    this.sqsDelete.inc({
      service: 'receipt-worker',
      queue: 'receipt-commands',
      status,
      version,
    });
  }

  recordReceiptProcessed(
    status: ReceiptStatus,
    version = this.version(),
  ): void {
    this.receiptsProcessed.inc({
      service: 'receipt-worker',
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
        service: 'receipt-worker',
        version: this.version(),
        commit: this.config.get<string>('GIT_COMMIT', 'local'),
      },
      1,
    );

    return this.registry.metrics();
  }

  version(): string {
    return this.config.get<string>('SERVICE_VERSION', 'stable');
  }
}
