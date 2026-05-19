# buyer-order-tracking

NestJS service for the buyer-facing tracking projection of the Black Friday demo.

It consumes lifecycle events from `buyer-tracking-events`, stores the read model in DynamoDB, publishes `customer_experience.order_tracking_updated.v1`, and exposes operational endpoints for Compose/Prometheus.

## Local Commands

Run commands from `05-demo`.

```bash
make test-buyer-order-tracking
make test-buyer-order-tracking-e2e
make test-full-saga-e2e
make verify-buyer-order-tracking
```

## Endpoints

```text
POST /internal/events
GET  /orders/:order_id/tracking
GET  /buyers/:buyer_id/orders
GET  /health
GET  /healthz
GET  /readyz
GET  /version
GET  /metrics
```

## Environment

```text
TRACKING_TABLE_NAME=buyer-visible-order-state
BUYER_ORDERS_INDEX_NAME=buyer_id-order_id-index
INPUT_SQS_QUEUE_URL=http://localhost:4566/000000000000/buyer-tracking-events
SQS_QUEUE_URL=http://localhost:4566/000000000000/customer-experience-events
TRACKING_CONSUMER_ENABLED=true
TRACKING_CONSUMER_DELAY_MS=0
```

## Metrics

```text
buyer_tracking_freshness_seconds
buyer_tracking_freshness_p95
buyer_tracking_freshness_under_60s_ratio
dynamodb_request_duration_seconds
```

## Controlled Failure Mode

```text
TRACKING_CONSUMER_DELAY_MS=3000   Keeps the saga moving while buyer-visible state becomes stale
```
