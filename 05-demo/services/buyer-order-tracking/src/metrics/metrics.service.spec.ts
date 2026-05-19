import { ConfigService } from '@nestjs/config';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('renders buyer tracking freshness metrics', async () => {
    const metrics = new MetricsService(
      new ConfigService({ SERVICE_VERSION: 'v1', GIT_COMMIT: 'test' }),
    );

    metrics.recordTrackingEvent('updated', 'orders.order_confirmed.v1', 'v1');
    metrics.observeFreshness({
      eventName: 'orders.order_confirmed.v1',
      visibleStatus: 'ORDER_CONFIRMED',
      version: 'v1',
      freshnessSeconds: 1,
    });
    metrics.observeDynamoDbDuration({
      operation: 'get_item',
      status: 'success',
      table: 'buyer-visible-order-state',
      version: 'v1',
      durationSeconds: 0.01,
    });
    metrics.observeCriticalJourney({
      visibleStatus: 'READY_TO_DISPATCH',
      version: 'v1',
      durationSeconds: 2,
    });

    const rendered = await metrics.render();

    expect(rendered).toContain('buyer_tracking_events_total');
    expect(rendered).toContain('buyer_tracking_freshness_seconds');
    expect(rendered).toContain(
      'buyer_tracking_freshness_p95{service="buyer-order-tracking",version="v1"} 1',
    );
    expect(rendered).toContain(
      'buyer_tracking_freshness_under_60s_ratio{service="buyer-order-tracking",version="v1"} 1',
    );
    expect(rendered).toContain('dynamodb_request_duration_seconds');
    expect(rendered).toContain(
      'critical_order_journey_under_60s_ratio{service="buyer-order-tracking",version="v1"} 1',
    );
  });
});
