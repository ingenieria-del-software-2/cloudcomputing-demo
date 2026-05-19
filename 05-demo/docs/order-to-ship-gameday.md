# Order-to-Ship GameDay Runbook

This is the PDR-aligned local path for the four CompraFiubi services:

| Service                |   Port | Responsibility                                                                        |
| ---------------------- | -----: | ------------------------------------------------------------------------------------- |
| `order-management`     | `3010` | Payment intake, idempotent order confirmation, cancellation after fulfillment failure |
| `fulfillment-planning` | `3020` | Stock reservation, fulfillment commitment, Promesa Express degradation                |
| `shipment-preparation` | `3030` | Shipment creation, S3-compatible dispatch documents, retry after blocked documents    |
| `buyer-order-tracking` | `3040` | Buyer-visible tracking projection, timeline, freshness and journey SLOs               |

## Scope

Included here:

- Docker Compose local runtime
- MiniStack SQS, S3-compatible bucket, and DynamoDB-compatible API
- PostgreSQL containers for service-owned relational state
- `/metrics` endpoints and optional local Prometheus HTTP queries
- controlled incidents for Promesa Express, document writes, tracking staleness, duplicates, and CPU distraction

Explicitly excluded from this local runbook:

- Terraform
- real AWS IAM changes
- Grafana dashboards

The local document-write incident uses `S3_PUT_OBJECT_ALLOWED=false` to simulate the same business impact as missing `s3:PutObject`. It does not claim to validate a real IAM policy.

## Preflight

Run from `05-demo`.

```bash
docker compose config
docker compose --profile metrics config
make test-full-saga-e2e
```

## Start The Local War Room Stack

Use the metrics profile when you want Prometheus queries. Skip `--profile metrics` if `/metrics` curl checks are enough.

```bash
make compose-down
PROMESA_EXPRESS_ERROR_RATE=0 PROMESA_EXPRESS_LATENCY_MS=0 \
  docker compose --profile metrics up -d --wait --build prometheus
```

Health checks:

```bash
curl -fsS http://localhost:3010/health
curl -fsS http://localhost:3020/health
curl -fsS http://localhost:3030/health
curl -fsS http://localhost:3040/health
```

## Stage 3 - Happy Path Suspicious

Send one controlled payment and inspect the buyer-facing result by buyer id.

```bash
node scripts/black-friday-load.mjs \
  --orders 1 \
  --concurrency 1 \
  --duplicate-rate 0 \
  --seed happy

curl -fsS http://localhost:3040/buyers/buyer_bf_happy_1/orders
curl -fsS http://localhost:3040/metrics | grep 'critical_order_journey_under_60s_ratio\|buyer_tracking_freshness_seconds'
```

Expected evidence:

- `order-management` returns a non-duplicate `ORDER_CONFIRMED` result.
- `buyer-order-tracking` reaches `READY_TO_DISPATCH`.
- Timeline entries share the same `correlation_id`.
- Metrics expose `critical_order_journey_under_60s_ratio` and `buyer_tracking_freshness_seconds`.

## Stage 4 - Promesa Express Degrades Fulfillment

Start a degraded stack. Keep the run bounded; the point is to create visible backlog and at-risk commitments, not heavy load.

```bash
make compose-down
PROMESA_EXPRESS_ENABLED=true \
PROMESA_EXPRESS_LATENCY_MS=1500 \
PROMESA_EXPRESS_ERROR_RATE=0.20 \
WORKER_CONCURRENCY=1 \
  docker compose --profile metrics up -d --wait --build prometheus

node scripts/black-friday-load.mjs \
  --orders 40 \
  --concurrency 8 \
  --duplicate-rate 0.10 \
  --seed express-bad

make sqs-backlog
curl -fsS http://localhost:3020/metrics | grep 'promesa_express_failures_total\|fulfillment_commitment_duration_seconds'
curl -fsS http://localhost:3040/metrics | grep 'critical_order_journey_under_60s_ratio\|buyer_tracking_freshness_p95'
```

Mitigation:

```bash
make compose-down
PROMESA_EXPRESS_ENABLED=false \
PROMESA_EXPRESS_LATENCY_MS=0 \
PROMESA_EXPRESS_ERROR_RATE=0 \
WORKER_CONCURRENCY=3 \
  docker compose --profile metrics up -d --wait --build prometheus

node scripts/black-friday-load.mjs \
  --orders 40 \
  --concurrency 8 \
  --duplicate-rate 0.10 \
  --seed express-fixed

make sqs-backlog
curl -fsS http://localhost:3040/metrics | grep 'critical_order_journey_under_60s_ratio\|buyer_tracking_freshness_p95'
```

Decision to discuss: turning off a conversion feature is acceptable when it protects the critical buyer journey.

## Stage 5 - Document Write Blocked

This simulates missing document-write permission locally, without real IAM.

```bash
make compose-down
S3_PUT_OBJECT_ALLOWED=false \
PROMESA_EXPRESS_ERROR_RATE=0 \
PROMESA_EXPRESS_LATENCY_MS=0 \
  docker compose --profile metrics up -d --wait --build prometheus

node scripts/black-friday-load.mjs \
  --orders 1 \
  --concurrency 1 \
  --duplicate-rate 0 \
  --seed s3-blocked

curl -fsS http://localhost:3040/buyers/buyer_bf_s3-blocked_1/orders
curl -fsS http://localhost:3030/metrics | grep 's3_put_object_total\|shipment_document_failures_total\|dispatch_document_failure_count'
```

Mitigation keeps the same local state and recreates only `shipment-preparation` with writes enabled:

```bash
S3_PUT_OBJECT_ALLOWED=true docker compose up -d --wait --no-deps --force-recreate shipment-preparation
curl -fsS -X POST http://localhost:3030/shipments/<shipment_id>/retry-documents
curl -fsS http://localhost:3030/shipments/<shipment_id>/documents
curl -fsS http://localhost:3040/orders/<order_id>/tracking
```

Expected evidence:

- The blocked run emits `shipping.dispatch_blocked.v1`.
- `s3_put_object_total{status="failure",reason="DOCUMENT_UPLOAD_ACCESS_DENIED"}` increases.
- Retry emits `shipping.dispatch_document_available.v1` and `shipping.shipment_ready_to_dispatch.v1`.
- Tracking moves from `DISPATCH_BLOCKED` to `READY_TO_DISPATCH` after retry.

## Stage 6 - Tracking Stale / User-Facing Truth

Start with a delayed tracking consumer. The internal saga can advance while buyer-visible state lags.

```bash
make compose-down
TRACKING_CONSUMER_DELAY_MS=3000 \
PROMESA_EXPRESS_ERROR_RATE=0 \
PROMESA_EXPRESS_LATENCY_MS=0 \
  docker compose --profile metrics up -d --wait --build prometheus

node scripts/black-friday-load.mjs \
  --orders 10 \
  --concurrency 4 \
  --duplicate-rate 0 \
  --seed tracking-stale

make sqs-backlog
curl -fsS http://localhost:3040/metrics | grep 'buyer_tracking_freshness_seconds\|buyer_tracking_freshness_p95\|buyer_tracking_freshness_under_60s_ratio'
```

Mitigation:

```bash
TRACKING_CONSUMER_DELAY_MS=0 docker compose up -d --wait --no-deps --force-recreate buyer-order-tracking
node scripts/black-friday-load.mjs \
  --orders 10 \
  --concurrency 4 \
  --duplicate-rate 0 \
  --seed tracking-fixed
curl -fsS http://localhost:3040/metrics | grep 'buyer_tracking_freshness_p95\|buyer_tracking_freshness_under_60s_ratio'
```

Decision to discuss: a system that processes internally but informs the buyer late is still degraded.

## Secondary - Duplicate Payment

```bash
node scripts/black-friday-load.mjs \
  --orders 8 \
  --concurrency 4 \
  --duplicate-rate 0.50 \
  --seed duplicate-demo

curl -fsS http://localhost:3010/metrics | grep 'duplicate_order_attempts_total'
```

Expected evidence:

- Duplicate `payment_id` attempts return accepted duplicate results.
- `orders.duplicate_payment_ignored.v1` is published.
- `duplicate_order_attempts_total` increases.

## Secondary - CPU Distraction

Run bounded CPU noise while checking the journey SLO. This is deliberately a distraction unless the user-facing journey degrades.

```bash
node scripts/cpu-noise.mjs --duration 30 --workers 1
curl -fsS http://localhost:3040/metrics | grep 'critical_order_journey_under_60s_ratio'
```

Decision to discuss: CPU is drill-down evidence, not the incident definition.

## Cleanup

```bash
make compose-down
```

If a command fails midway, run `docker compose --profile metrics down --remove-orphans -v` and restart the stage.
