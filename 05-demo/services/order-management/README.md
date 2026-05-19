# order-management

NestJS HTTP API for the CompraFiubi GameDay order service.

It receives mocked payment approvals, creates commercial orders idempotently by `payment_id`, publishes order lifecycle events to SQS, and exposes operational endpoints for Docker/Prometheus.

## Local Commands

Run commands from the repo root. `make` is the public DX API; package scripts stay package-local for implementation detail and editor tooling.

```bash
make test-order-management
make test-order-management-e2e
make verify-order-management
```

## Endpoints

```text
POST /internal/payments/approved
GET /orders/:order_id
GET /health
GET /healthz
GET /readyz
GET /version
GET /metrics
```

## Environment

```text
PORT=3000
SERVICE_VERSION=v1
GIT_COMMIT=local
DATABASE_URL=postgresql://order:order@localhost:15432/order_management
AWS_REGION=us-east-1
AWS_ENDPOINT_URL=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SQS_QUEUE_URL=http://localhost:4566/000000000000/orders-confirmed-intake
IDEMPOTENCY_ENABLED=true
```
