import { ConfigService } from '@nestjs/config';
import { MetricsService } from './metrics.service';

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

  it('records fulfillment outcomes', async () => {
    service.recordFulfillment('committed', 'v1');
    service.recordFulfillment('commitment_failed', 'v1');
    service.recordFulfillment('duplicate_event_ignored', 'v1');

    const metrics = await service.render();

    expect(metrics).toContain(
      'fulfillment_commitments_total{service="fulfillment-planning",status="committed",version="v1"} 1',
    );
    expect(metrics).toContain(
      'fulfillment_commitments_total{service="fulfillment-planning",status="commitment_failed",version="v1"} 1',
    );
    expect(metrics).toContain(
      'fulfillment_commitments_total{service="fulfillment-planning",status="duplicate_event_ignored",version="v1"} 1',
    );
  });

  it('records SQS publish outcomes', async () => {
    service.recordSqsPublish('success', 'v1');
    service.recordSqsPublish('failure', 'v1');

    const metrics = await service.render();

    expect(metrics).toContain(
      'sqs_publish_total{service="fulfillment-planning",queue="fulfillment-commitment-intake",status="success",version="v1"} 1',
    );
    expect(metrics).toContain(
      'sqs_publish_total{service="fulfillment-planning",queue="fulfillment-commitment-intake",status="failure",version="v1"} 1',
    );
  });

  it('records commitment duration buckets', async () => {
    service.observeCommitmentDuration('committed', 'v1', 0.01);

    await expect(service.render()).resolves.toContain(
      'fulfillment_commitment_duration_seconds_bucket{le="0.01",service="fulfillment-planning",status="committed",version="v1"} 1',
    );
  });

  it('records HTTP request duration buckets', async () => {
    service.recordHttpRequest({
      route: '/internal/events',
      method: 'POST',
      status: '202',
      version: 'v1',
      durationSeconds: 0.01,
    });

    await expect(service.render()).resolves.toContain(
      'http_request_duration_seconds_bucket{le="0.01",service="fulfillment-planning",route="/internal/events",method="POST",status="202",version="v1"} 1',
    );
  });

  it('renders build info metadata', async () => {
    await expect(service.render()).resolves.toContain(
      'build_info{service="fulfillment-planning",version="v1",commit="test"} 1',
    );
  });

  it('collects default Node.js metrics with the service label', async () => {
    const metrics = await service.render();

    expect(metrics).toContain('nodejs_version_info{');
    expect(metrics).toContain('service="fulfillment-planning"');
  });

  it('exposes the registry content type', () => {
    expect(service.contentType).toBe(
      'text/plain; version=0.0.4; charset=utf-8',
    );
  });
});
