import { MetricsService } from './metrics.service';
import { ConfigService } from '@nestjs/config';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService(
      new ConfigService({
        SERVICE_VERSION: 'v1',
        GIT_COMMIT: 'test',
      }),
    );
  });

  it('records order outcomes', async () => {
    service.recordOrder('confirmed', 'v1');
    service.recordTransaction('invalid', 'v1');
    service.recordTransaction('idempotency_conflict', 'v1');

    const metrics = await service.render();

    expect(metrics).toContain(
      'orders_total{service="order-management",status="confirmed",version="v1"} 1',
    );
    expect(metrics).toContain(
      'orders_total{service="order-management",status="invalid",version="v1"} 1',
    );
    expect(metrics).toContain(
      'orders_total{service="order-management",status="idempotency_conflict",version="v1"} 1',
    );
  });

  it('records SQS publish outcomes', async () => {
    service.recordSqsPublish('success', 'v1');
    service.recordSqsPublish('failure', 'v1');

    const metrics = await service.render();

    expect(metrics).toContain(
      'sqs_publish_total{service="order-management",queue="orders-confirmed-intake",status="success",version="v1"} 1',
    );
    expect(metrics).toContain(
      'sqs_publish_total{service="order-management",queue="orders-confirmed-intake",status="failure",version="v1"} 1',
    );
  });

  it('records HTTP request duration buckets', async () => {
    service.recordHttpRequest({
      route: '/transactions',
      method: 'POST',
      status: '202',
      version: 'v1',
      durationSeconds: 0.01,
    });

    await expect(service.render()).resolves.toContain(
      'http_request_duration_seconds_bucket{le="0.01",service="order-management",route="/transactions",method="POST",status="202",version="v1"} 1',
    );
  });

  it('renders build info metadata', async () => {
    await expect(service.render()).resolves.toContain(
      'build_info{service="order-management",version="v1",commit="test"} 1',
    );
  });

  it('collects default Node.js metrics with the service label', async () => {
    const metrics = await service.render();

    expect(metrics).toContain('nodejs_version_info{');
    expect(metrics).toContain('service="order-management"');
  });

  it('exposes the registry content type', () => {
    expect(service.contentType).toBe(
      'text/plain; version=0.0.4; charset=utf-8',
    );
  });
});
