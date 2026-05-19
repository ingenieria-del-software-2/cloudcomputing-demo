# Belo Progressive Delivery Lab

This directory now contains two local demo tracks:

- **CompraFiubi Order-to-Ship GameDay**: the PDR-aligned four-service saga used for Black Friday incident practice. Start with [`docs/order-to-ship-gameday.md`](./docs/order-to-ship-gameday.md).
- **Progressive Delivery Lab**: the original kind, Istio, Flagger, and k6 rollout lab documented below.

## CompraFiubi Order-to-Ship GameDay

The local GameDay path covers `order-management`, `fulfillment-planning`, `shipment-preparation`, and `buyer-order-tracking` with Docker Compose, MiniStack, PostgreSQL containers, and service `/metrics` endpoints.

It intentionally excludes Terraform, real AWS IAM changes, and Grafana dashboards. Local incident evidence is driven by environment variables, scripts, `/metrics`, logs, and Prometheus HTTP queries.

Quick checks from `05-demo`:

```bash
docker compose config
make test-full-saga-e2e
node scripts/black-friday-load.mjs --dry-run --orders 5 --duplicate-rate 0.4 --seed demo
```

GameDay references:

- Local runbook: [`docs/order-to-ship-gameday.md`](./docs/order-to-ship-gameday.md)
- Prometheus queries without Grafana: [`docs/war-room-prometheus-queries.md`](./docs/war-room-prometheus-queries.md)
- Black Friday load generator: [`scripts/black-friday-load.mjs`](./scripts/black-friday-load.mjs)
- CPU distraction generator: [`scripts/cpu-noise.mjs`](./scripts/cpu-noise.mjs)

A local [kind](https://kind.sigs.k8s.io/) lab demonstrating [Flagger](https://flagger.app/) progressive delivery rollouts, validated end-to-end with [k6](https://k6.io/).

## Quickstart

**Prerequisites:** Docker, kind, kubectl, Helm, k6

```bash
make doctor   # check toolchain
make demo     # full Blue/Green + Canary evidence
```

Or run setup once and pick scenarios:

```bash
make setup
make bluegreen
make canary
make preview     # optional
make rollback    # optional
```

Inspect or clean up: `make status`, `make clean`. Run `make` with no arguments to list every target.

The Istio Gateway is exposed at `http://127.0.0.1:8080`. Long Flagger waits stream `canary/transaction-api` status so progress stays visible.

## Scope

The lab exercises Flagger's progressive delivery controller against a single service, `transaction-api`. `ledger-service`, `receipt-worker`, and MiniStack stay on stable versions throughout - they keep the request path realistic, not participate in rollouts. One service end-to-end is enough to validate controller behavior; multi-service coordinated rollouts are an orchestration problem outside Flagger's contract.

### Blue/Green - `make bluegreen`

Flagger runs the full promotion: a healthy v2 candidate comes up, normal traffic continues on v1, and k6 drives load against `transaction-api-canary` via port-forward before promotion. Traffic is **not** mirrored - `POST /transactions` publishes to SQS, and a mirrored route would double-publish. The port-forward stands in for what would be a private synthetic runner or internal validation route in production.

Status path: `Initialized → Progressing → Promoting → Finalising → Succeeded`

### Canary - `make canary`

Flagger shifts traffic incrementally (25% → 50% → promote) and evaluates Prometheus metric gates at each step. k6 generates load through the Istio Gateway; the controller decides whether to advance, hold, or abort based on thresholds defined in the `Canary` resource (see [`docs/rollout-gates-and-slos.md`](./docs/rollout-gates-and-slos.md)). This is the scenario that exercises Flagger's analysis loop - Blue/Green only exercises the promotion mechanism.

Status path: `Initialized → Progressing 25 → Progressing 50 → Promoting → Finalising → Succeeded`

### Bonus scenarios

Extra evidence on top of the core path. Not required to validate the controller, but each shows a real capability worth seeing:

- **`make preview`** - Istio header routing (`x-release-track: preview`) to a parallel `transaction-api-preview` deployment. A pre-rollout validation pattern that lets specific traffic reach the candidate without involving the rollout controller.
- **`make rollback`** - A v2 candidate fails the metric gates under injected errors; Flagger aborts to `Failed` and v1 keeps serving. Makes the abort path explicit, complementing the success-path scenarios.

## Manual Walkthrough

To reproduce the demo step by step instead of running `make demo`, see [`docs/manual-flow.md`](./docs/manual-flow.md).

If you get lost:

```bash
make status
kubectl -n belo get canary transaction-api -o wide
kubectl -n belo describe canary transaction-api
make scenario-clean   # reset only scenario resources
make clean            # full teardown
```

## Reference

`make` from the repo root is the public API. Targets in `dev.mk` and `infra.mk` are maintainer diagnostics.

| Command          | Purpose                                                                          |
| ---------------- | -------------------------------------------------------------------------------- |
| `make doctor`    | Check required local tools                                                       |
| `make setup`     | Build images, create kind cluster, install Prometheus/Istio/Flagger, deploy core |
| `make demo`      | Run Blue/Green + Canary evidence                                                 |
| `make bluegreen` | Re-run only the Blue/Green rollout                                               |
| `make canary`    | Re-run only the Canary rollout                                                   |
| `make preview`   | Optional header-routing evidence                                                 |
| `make rollback`  | Optional rollback evidence                                                       |
| `make status`    | Show current cluster state                                                       |
| `make clean`     | Delete the local kind cluster                                                    |

- Runtime baseline: [`docs/runtime-baseline.md`](./docs/runtime-baseline.md)
- Architecture: [`docs/architecture.md`](./docs/architecture.md)
- Gates & SLOs: [`docs/rollout-gates-and-slos.md`](./docs/rollout-gates-and-slos.md)
- ADRs: [`docs/decisions/`](./docs/decisions/)
