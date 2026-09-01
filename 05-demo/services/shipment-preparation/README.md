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
POST /shipments/:shipment_id/retry-documents
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

## Local S3 Retry/Fix Runbook

Use this when the demo simulates missing `s3:PutObject` permission with `S3_PUT_OBJECT_ALLOWED=false`. This is a local simulation of the business impact, not proof of a real IAM policy.

```bash
S3_PUT_OBJECT_ALLOWED=false make compose-app-up
curl -fsS -X POST http://localhost:3030/internal/events -H 'Content-Type: application/json' -d @commitment.json
curl -fsS http://localhost:3030/metrics | grep 's3_put_object_total\|dispatch_document_failure_count'
S3_PUT_OBJECT_ALLOWED=true docker compose up -d --wait --no-deps --force-recreate shipment-preparation
curl -fsS -X POST http://localhost:3030/shipments/<shipment_id>/retry-documents
curl -fsS http://localhost:3030/shipments/<shipment_id>/documents
```

Expected evidence:

```text
shipping.dispatch_blocked.v1 is emitted while writes are denied
s3_put_object_total{status="failure",reason="DOCUMENT_UPLOAD_ACCESS_DENIED"} increases
POST /shipments/<shipment_id>/retry-documents turns documents AVAILABLE after the fix
shipping.dispatch_document_available.v1 and shipping.shipment_ready_to_dispatch.v1 are emitted
```
