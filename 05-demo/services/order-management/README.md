# transaction-api

NestJS HTTP API and the only rollout target for the progressive delivery lab.

It receives `POST /transactions`, calls `ledger-service`, publishes `GenerateReceiptCommand` to SQS, and exposes operational endpoints for Kubernetes and Prometheus.

## Local Commands

Run commands from the repo root. `make` is the public DX API; package scripts stay package-local for implementation detail and editor tooling.

```bash
make test-transaction-api
make test-integration
make test-e2e
make verify-transaction-api
```

## Endpoints

```text
POST /transactions
GET /healthz
GET /readyz
GET /version
GET /metrics
```
