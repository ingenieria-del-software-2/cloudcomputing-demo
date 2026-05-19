# fulfillment-planning

NestJS service for the fulfillment stage of the Black Friday demo.

It consumes `orders.order_confirmed.v1`, reserves stock in PostgreSQL, publishes fulfillment commitment events to SQS, and exposes operational endpoints for Compose/Prometheus.

Fulfillment events can also be mirrored to `buyer-tracking-events` with `TRACKING_SQS_QUEUE_URL` so `buyer-order-tracking` can maintain the buyer-visible read model.

## Local Commands

Run commands from `05-demo`.

```bash
make test-fulfillment-planning
make test-fulfillment-planning-e2e
make verify-fulfillment-planning
```

## Endpoints

```text
POST /internal/events
GET  /fulfillment/orders/:order_id
GET  /inventory/:seller_sku
GET  /health
GET  /healthz
GET  /readyz
GET  /version
GET  /metrics
```

## Controlled Failure Mode

```text
PROMESA_EXPRESS_ENABLED=true        Enables the degradable commercial feature
PROMESA_EXPRESS_LATENCY_MS=1500     Adds artificial latency to fulfillment decisions
PROMESA_EXPRESS_ERROR_RATE=0.20     Emits at-risk commitments for some orders
WORKER_CONCURRENCY=1                Makes backlog easier to observe during load
```

Mitigation for the local GameDay is to recreate the service with `PROMESA_EXPRESS_ENABLED=false`, latency/error set to `0`, and higher `WORKER_CONCURRENCY` when the journey SLO is degraded.

## Metrics

```text
fulfillment_commitment_duration_seconds
delivery_promise_created_within_15s_ratio
confirmed_orders_without_stock_shortage_cancellation_ratio
delivery_promise_stability_ratio
promesa_express_failures_total
event_backlog_depth
event_dlq_depth
```
