# CompraFiubi Order-to-Ship GameDay

The local GameDay path covers `order-management`, `fulfillment-planning`, `shipment-preparation`, and `buyer-order-tracking` with Docker Compose, MiniStack, PostgreSQL containers, V3 HTTP-to-local-SQS event forwarding, and service `/metrics` endpoints.

It intentionally excludes Terraform, real AWS IAM changes, and Grafana dashboards. Local incident evidence is driven by environment variables, scripts, `/metrics`, logs, and Prometheus HTTP queries.

The earlier rollout lab has been removed from this demo so the local runtime matches the active PDR service boundary.

Quick checks from `05-demo`:

```bash
make doctor
docker compose config --quiet
make test-full-saga-e2e
node scripts/black-friday-load.mjs --dry-run --orders 5 --duplicate-rate 0.4 --seed demo
```

GameDay references:

- Local runbook: [`docs/order-to-ship-gameday.md`](./docs/order-to-ship-gameday.md)
- Prometheus queries without Grafana: [`docs/war-room-prometheus-queries.md`](./docs/war-room-prometheus-queries.md)
- Black Friday load generator: [`scripts/black-friday-load.mjs`](./scripts/black-friday-load.mjs)
- CPU distraction generator: [`scripts/cpu-noise.mjs`](./scripts/cpu-noise.mjs)

## Quickstart

**Prerequisites:** Docker, Corepack, curl

```bash
make doctor
make setup
make demo
```

Useful local targets:

```bash
make verify
make compose-app-up
make compose-metrics-up
make sqs-backlog
make compose-down
```

Inspect or clean up with `make status` and `make clean`. Run `make` with no arguments to list every target.

## Scope

The local demo validates the order-to-ship saga and incident evidence only. AWS Terraform, IAM, managed queues, managed observability, and Grafana dashboards remain future production-evolution work.

## Reference

| Command | Purpose |
| --- | --- |
| `make doctor` | Check Docker/Corepack/curl and Docker daemon access |
| `make setup` | Build active images and start local dependencies |
| `make demo` | Run the full local order-to-ship saga e2e |
| `make verify` | Run lint, typecheck, unit tests, e2e, and build |
| `make test-prometheus` | Start local Prometheus and verify service metrics ingestion |
| `make status` | Show current Compose state |
| `make clean` | Stop containers and remove local volumes |
