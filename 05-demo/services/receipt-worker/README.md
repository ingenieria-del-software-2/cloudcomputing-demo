# receipt-worker

NestJS worker estable para consumir `GenerateReceiptCommand` desde la queue SQS `receipt-commands`.

No expone endpoints de negocio. Solo procesa trabajo async no crítico y publica métricas Prometheus.

## Endpoints

```text
GET /healthz
GET /readyz
GET /version
GET /metrics
```

## Environment

```text
PORT=3002
SERVICE_VERSION=stable
GIT_COMMIT=local
AWS_REGION=us-east-1
AWS_ENDPOINT_URL=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SQS_QUEUE_URL=http://localhost:4566/000000000000/receipt-commands
SQS_POLLING_ENABLED=true
SQS_MAX_MESSAGES=5
SQS_WAIT_TIME_SECONDS=2
SQS_VISIBILITY_TIMEOUT_SECONDS=30
SQS_POLL_ERROR_DELAY_MS=500
RECEIPT_PROCESSING_DELAY_MS=0
```

## Local Commands

Run commands from the repo root. `make` is the public DX API; package scripts stay package-local for implementation detail and editor tooling.

```bash
make test-receipt-worker
make test-worker-e2e
make verify-receipt-worker
```

## Metrics

```text
sqs_consume_total{service="receipt-worker",queue="receipt-commands",status,version}
sqs_delete_total{service="receipt-worker",queue="receipt-commands",status,version}
receipt_processed_total{service="receipt-worker",status,version}
http_requests_total{service="receipt-worker",route,method,status,version}
http_request_duration_seconds{service="receipt-worker",route,method,status,version}
build_info{service="receipt-worker",version,commit}
```
