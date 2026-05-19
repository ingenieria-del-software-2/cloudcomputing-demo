import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

type TransactionStatus =
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
  private readonly registry = new Registry();
  private readonly httpRequests: Counter<string>;
  private readonly httpDuration: Histogram<string>;
  private readonly transactions: Counter<string>;
  private readonly ledgerRequests: Counter<string>;
  private readonly sqsPublish: Counter<string>;
  private readonly buildInfo: Gauge<string>;

  constructor(private readonly config: ConfigService = new ConfigService()) {
    collectDefaultMetrics({
      register: this.registry,
      labels: {
        service: 'transaction-api',
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
    this.transactions = new Counter({
      name: 'transactions_total',
      help: 'Total transaction outcomes',
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
      help: 'Total receipt queue publish attempts',
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
      service: 'transaction-api',
      route: labels.route,
      method: labels.method,
      status: labels.status,
      version: labels.version,
    };
    this.httpRequests.inc(metricLabels);
    this.httpDuration.observe(metricLabels, labels.durationSeconds);
  }

  recordTransaction(status: TransactionStatus, version: string): void {
    this.transactions.inc({ service: 'transaction-api', status, version });
  }

  recordLedgerRequest(status: LedgerStatus, version: string): void {
    this.ledgerRequests.inc({ service: 'transaction-api', status, version });
  }

  recordSqsPublish(status: SqsStatus, version: string): void {
    this.sqsPublish.inc({
      service: 'transaction-api',
      queue: 'receipt-commands',
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
        service: 'transaction-api',
        version: this.config.get<string>('SERVICE_VERSION', 'v1'),
        commit: this.config.get<string>('GIT_COMMIT', 'local'),
      },
      1,
    );

    return this.registry.metrics();
  }
}
