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
