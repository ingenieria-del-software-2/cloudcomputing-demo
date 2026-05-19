# ADR-003: SQS work queue and MiniStack

## Context

The transaction path should include async work, but SQS must not become a fake event log or audit system.

A queue is useful because it proves that a candidate API can still publish downstream work during a rollout. It is not the source of truth for transaction state.

## Decision

MiniStack SQS is used as a work queue for `GenerateReceiptCommand`.

`transaction-api` publishes receipt commands after the ledger call. `receipt-worker` consumes those commands. SQS is not used as an audit log, event log, saga transport, or source of truth.

The command carries the operation, transaction, ledger entry, request id, idempotency hash, producer version, and creation time needed for worker processing and log correlation.

Because SQS is at-least-once, `receipt-worker` dedupes by `operation_id`. The dedupe store is in-memory.

MiniStack itself is not the rollout metric source. `transaction-api` exposes SQS publish metrics, and `receipt-worker` exposes consume/delete/processing metrics.

## Why this fits the challenge

- Blue/Green and Canary gates can include SQS publish health.
- Local Kubernetes remains reproducible.
- k6 can validate the API path without requiring a managed cloud dependency.
- The async path adds operational realism without adding durable workflow state.

## Consequences

### Positive

- The lab includes real local async behavior.
- Rollout health covers more than HTTP status.
- MiniStack avoids local SQS login/token friction.

### Tradeoffs

- MiniStack is local test infrastructure, not production infrastructure.
- Queue contents are not durable production state.
- Worker dedupe is not durable across restarts.
- There is no DLQ or replay workflow.
- If ledger succeeds and SQS publish fails, the recovery path is idempotent retry rather than compensation.

## Alternatives considered

- LocalStack: valid, but current login/token friction hurts local reproducibility.
- No SQS: simpler, but loses async publish evidence.
- Kafka or NATS: more platform than this challenge needs.
- Postgres outbox: correct for production durability, but requires a database and migrations.
- Request mirroring for `POST /transactions`: rejected because it would duplicate writes and SQS publishes.

## Production evolution

Production would use managed SQS, DLQ, replay tooling, alarms, and possibly a transactional outbox if a durable database owns transaction state. Audit storage should be separate from the work queue.

## Takeaway

SQS is included for a narrow operational reason: prove the candidate still performs required async work during rollout.
