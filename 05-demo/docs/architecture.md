# Architecture

Belo Progressive Delivery Lab demonstrates a safe release workflow for a small transaction path running on local Kubernetes.

The point of the lab is not to model a complete financial platform. The point is to show that a versioned HTTP service can be released with controlled traffic, observable gates, and a clear rollback path.

The core demo path is Blue/Green plus Canary. Preview and rollback are optional evidence; the core path should still pass when optional scenarios are skipped.

## Topology

```text
client / k6
  -> Istio Gateway
    -> transaction-api
      -> ledger-service
      -> MiniStack SQS
        -> receipt-worker
```

## Service responsibilities

| Service | Role | Rollout behavior |
| --- | --- | --- |
| `transaction-api` | HTTP-facing service, transaction orchestration, ledger call, SQS publish, rollout metrics | Versioned `v1` / `v2`; only rollout target |
| `ledger-service` | Stable internal HTTP dependency | Stable dependency |
| `receipt-worker` | Stable SQS consumer for receipt commands | Stable dependency |
| MiniStack SQS | Local SQS-compatible work queue | Stable local dependency |

`transaction-api` is intentionally the only progressive delivery target. That keeps Blue/Green, Canary, rollback, and failure attribution easy to inspect.

## Transaction contract

`POST /transactions` is accepted only after the synchronous ledger call succeeds and the receipt command is queued.

| Condition | Result |
| --- | --- |
| Ledger call succeeds and SQS publish succeeds | `202 Accepted` with operation, transaction, ledger, receipt, and version fields |
| Same `Idempotency-Key` and same payload is retried | safe replay of the accepted result |
| Same `Idempotency-Key` is reused with a different payload | `409 IDEMPOTENCY_CONFLICT` |
| Ledger dependency fails or times out | `502` or `504`, no SQS publish |
| SQS publish fails after ledger success | `503 RECEIPT_QUEUE_FAILED`, not accepted as complete |

State is intentionally in-memory: `transaction-api` stores idempotency by `Idempotency-Key`, `ledger-service` replays ledger entries by the same key, and `receipt-worker` dedupes commands by `operation_id`. Durable storage belongs in production evolution, not in the local demo core.

The receipt message is a command, not a domain event:

```text
GenerateReceiptCommand -> receipt-commands
```

It carries `schema_version`, `command_id`, `operation_id`, transaction, ledger, request, idempotency hash, producer version, and creation time needed for worker processing and log correlation. SQS remains a work queue, not the source of truth.

SQS is treated as at-least-once. Duplicate receipt commands are safe because the worker logs `receipt_duplicate_ignored` and deletes them after the `operation_id` dedupe check.

## Release scenarios

| Scenario | Purpose | Core? |
| --- | --- | --- |
| Blue/Green | Full promotion of healthy `transaction-api` v2 with Flagger-owned routing | Yes |
| Canary | Progressive promotion of healthy `transaction-api` v2 with Prometheus gates | Yes |
| Preview | Header-routed access to preview v2 using Istio | Optional evidence |
| Rollback | Broken v2 candidate is aborted and traffic returns to stable v1 | Optional evidence |

Preview is manual Istio routing. Blue/Green and Canary are Flagger-owned. These paths are kept separate so manual routing does not compete with Flagger-generated routing.

Preview is opt-in synthetic traffic via `x-release-track: preview`, not a dark launch. Normal traffic remains on the stable service.

## Lab scope

Included:

- kind
- Istio
- Flagger
- Prometheus
- MiniStack SQS
- k6
- three services
- Kubernetes manifests and Kustomize overlays
- Dockerfiles

Excluded:

- Postgres
- DLQ
- transactional outbox
- saga orchestration
- Argo CD
- Argo Rollouts
- OpenTelemetry
- required Grafana or Kiali

Those are valid production evolutions, but they are not needed to prove the release workflow locally.

## Operational intent

The lab treats release safety as an operational problem:

- reduce blast radius
- validate the candidate before promotion
- fail closed when candidate metrics are missing
- keep IDs in logs, not Prometheus labels
- avoid request mirroring for `POST /transactions`
- keep rollback visible and repeatable

The system should be understandable without reading every manifest first.
