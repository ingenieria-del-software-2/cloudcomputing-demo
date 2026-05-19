# ADR-002: Service boundaries and rollout target

## Context

The lab needs enough topology to feel like a financial transaction path, but not so much that rollout behavior becomes hard to attribute.

Canarying multiple services at once would make a failed rollout ambiguous. The candidate under test and the stable dependencies should be obvious.

## Decision

`transaction-api` is the only rollout target.

`ledger-service` and `receipt-worker` remain stable dependencies. `transaction-api` and `receipt-worker` use NestJS/TypeScript because they own the SQS code paths. `ledger-service` uses Go because it is a small stable HTTP dependency.

## Why this fits the challenge

- Blue/Green and Canary focus on one HTTP-facing service.
- Local Kubernetes stays understandable.
- k6 can validate one clear ingress path.
- The topology still includes an internal dependency and async worker.
- Documentation can explain failure attribution without a long system map.

## Consequences

### Positive

- Failures during rollout are attributable to `transaction-api` v2.
- The lab demonstrates HTTP, internal service calls, and async work without multiplying rollout targets.
- Stable dependencies simplify rollback reasoning.

### Tradeoffs

- The lab does not show canarying an internal service.
- Worker rollout safety is not modeled here.
- Polyglot services add two toolchains.

## Alternatives considered

- Canary every service: realistic in some platforms, but noisy for this challenge.
- Roll out `ledger-service`: harder to explain because failures could come from API or ledger.
- Two-service pricing demo: simpler, but weaker transaction-path signal.
- Go-only core: simpler tooling, but would duplicate SQS implementation choices across services.
- Four-service flow: more realistic, more cognitive load.

## Production evolution

Production would define rollout policies per service class. API, ledger, and workers may need different deployment strategies, alerts, and rollback procedures.

## Takeaway

The lab shows restraint: one candidate, stable dependencies, and clear blast-radius control.
