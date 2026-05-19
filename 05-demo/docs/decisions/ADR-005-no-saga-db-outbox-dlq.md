# ADR-005: No saga, database, outbox, or DLQ

## Context

The challenge is progressive delivery, not distributed transaction coordination.

Adding saga orchestration, durable workflow state, Postgres, outbox, and DLQ handling would make the system look more complete, but it would also move attention away from the rollout mechanics.

## Decision

The demo does not implement a saga, database, transactional outbox, or DLQ.

The transaction flow stays synchronous until the ledger call completes, then publishes a receipt work command to SQS. Idempotency and retry behavior are kept minimal and local.

`202 Accepted` means the ledger call succeeded and the receipt command was queued. Later worker processing does not change the HTTP operation result, so the demo avoids fake `PROCESSING`, `COMPENSATING`, or `COMPLETED` states.

## Why this fits the challenge

- Blue/Green and Canary remain the main story.
- The local demo workflow stays runnable.
- The failure model is easier to explain.
- k6 validates release behavior instead of a distributed workflow.
- Documentation can be honest about what is intentionally out of scope.

## Consequences

### Positive

- Lower local setup risk.
- Less fake financial-domain complexity.
- Fewer moving parts during rollback.
- Clearer challenge evaluation.

### Tradeoffs

- No durable transaction state.
- No durable idempotency after pod restart.
- No DLQ replay story.
- No transactional guarantee between ledger state and SQS publish.
- No audit trail.

## Alternatives considered

- Saga or workflow engine: too much scope for the demo.
- Postgres ledger state: useful in production, unnecessary for rollout validation.
- Transactional outbox: correct with a durable database, but artificial without one.
- DLQ in core: useful, but adds queue policy and replay behavior that the challenge does not require.
- Event-sourced flow: more domain architecture than release safety.

## Production evolution

A real platform would add durable idempotency, database-backed ledger state, outbox publishing, DLQ, replay tooling, audit retention, and recovery procedures.

## Takeaway

The lab reduces scope without reducing release quality. It avoids pretending that a local demo proves distributed transaction safety.
