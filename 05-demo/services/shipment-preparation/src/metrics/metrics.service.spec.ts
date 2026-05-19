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

  it('records shipment outcomes', async () => {
    service.recordShipment('ready_to_dispatch', 'v1');
    service.recordShipment('dispatch_blocked', 'v1');
    service.recordShipment('duplicate_event_ignored', 'v1');

    const metrics = await service.render();

    expect(metrics).toContain(
      'shipments_total{service="shipment-preparation",status="ready_to_dispatch",version="v1"} 1',
    );
    expect(metrics).toContain(
      'shipments_total{service="shipment-preparation",status="dispatch_blocked",version="v1"} 1',
    );
    expect(metrics).toContain(
      'shipments_total{service="shipment-preparation",status="duplicate_event_ignored",version="v1"} 1',
    );
  });

  it('records document failures', async () => {
    service.recordDocumentFailure('v1');

    const metrics = await service.render();

    expect(metrics).toContain(
      'shipment_document_failures_total{service="shipment-preparation",version="v1"} 1',
    );
    expect(metrics).toContain(
      'dispatch_document_failure_count{service="shipment-preparation",version="v1"} 1',
    );
  });

  it('records shipment SLO gauges', async () => {
    service.recordReadyBeforeCutoff('v1', true);
    service.recordDocumentAvailabilityOnAccess('v1', false);
    service.recordDocumentAvailabilityOnAccess('v1', true);

    const metrics = await service.render();

    expect(metrics).toContain(
      'ready_to_dispatch_before_seller_cutoff_ratio{service="shipment-preparation",version="v1"} 1',
    );
    expect(metrics).toContain(
      'dispatch_document_availability_on_first_access_ratio{service="shipment-preparation",version="v1"} 0.5',
    );
  });

  it('records SQS publish outcomes', async () => {
    service.recordSqsPublish('success', 'v1');
    service.recordSqsPublish('failure', 'v1');

    const metrics = await service.render();

    expect(metrics).toContain(
      'sqs_publish_total{service="shipment-preparation",queue="buyer-tracking-events",status="success",version="v1"} 1',
    );
    expect(metrics).toContain(
      'sqs_publish_total{service="shipment-preparation",queue="buyer-tracking-events",status="failure",version="v1"} 1',
    );
  });

  it('records local S3 PutObject outcomes', async () => {
    service.recordS3PutObject({
      bucket: 'seller-dispatch-documents-lab',
      status: 'success',
      reason: 'OK',
      version: 'v1',
    });
    service.recordS3PutObject({
      bucket: 'seller-dispatch-documents-lab',
      status: 'failure',
      reason: 'DOCUMENT_UPLOAD_ACCESS_DENIED',
      version: 'v1',
    });

    const metrics = await service.render();

    expect(metrics).toContain(
      's3_put_object_total{service="shipment-preparation",bucket="seller-dispatch-documents-lab",status="success",reason="OK",version="v1"} 1',
    );
    expect(metrics).toContain(
      's3_put_object_total{service="shipment-preparation",bucket="seller-dispatch-documents-lab",status="failure",reason="DOCUMENT_UPLOAD_ACCESS_DENIED",version="v1"} 1',
    );
  });

  it('records shipment duration buckets', async () => {
    service.observeShipmentDuration('ready_to_dispatch', 'v1', 0.01);

    await expect(service.render()).resolves.toContain(
      'shipment_preparation_duration_seconds_bucket{le="0.01",service="shipment-preparation",status="ready_to_dispatch",version="v1"} 1',
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
      'http_request_duration_seconds_bucket{le="0.01",service="shipment-preparation",route="/internal/events",method="POST",status="202",version="v1"} 1',
    );
  });

  it('renders build info metadata', async () => {
    await expect(service.render()).resolves.toContain(
      'build_info{service="shipment-preparation",version="v1",commit="test"} 1',
    );
  });

  it('collects default Node.js metrics with the service label', async () => {
    const metrics = await service.render();

    expect(metrics).toContain('nodejs_version_info{');
    expect(metrics).toContain('service="shipment-preparation"');
  });

  it('exposes the registry content type', () => {
    expect(service.contentType).toBe(
      'text/plain; version=0.0.4; charset=utf-8',
    );
  });
});
