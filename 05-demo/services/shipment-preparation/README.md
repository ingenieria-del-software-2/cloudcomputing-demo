# shipment-preparation

NestJS service for the shipping stage of the Black Friday demo.

It consumes `fulfillment.commitment_confirmed.v1`, creates shipments, stores dispatch labels/instructions in S3, publishes shipping events to SQS, and exposes operational endpoints for Compose/Prometheus.

## Local Commands

Run commands from `05-demo`.

```bash
make test-shipment-preparation
make test-shipment-preparation-e2e
make verify-shipment-preparation
```

## Endpoints

```text
POST /internal/events
GET  /shipments/:shipment_id
GET  /shipments/:shipment_id/documents
GET  /health
GET  /healthz
GET  /readyz
GET  /version
GET  /metrics
```

## Controlled Failure Modes

```text
S3_PUT_OBJECT_ALLOWED=false              Simulates AccessDenied for s3:PutObject
S3_BAD_KEY_ENABLED=true                  Generates invalid S3 document keys
S3_TRANSIENT_FAILURES_BEFORE_SUCCESS=1   Forces retryable S3 upload failures
SELLER_CUTOFF_EXPIRED=true               Marks the shipment as blocked by cutoff
```
