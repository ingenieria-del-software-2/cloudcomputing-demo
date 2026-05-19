# ADR-004: Prometheus gates and rollback

## Context

A rollout gate that cannot see candidate traffic is dangerous. Missing metrics must not be interpreted as a healthy release.

This matters in financial systems because a bad release can affect user trust quickly. The rollback path must be observable and based on candidate behavior, not stale primary metrics.

## Decision

Flagger analysis uses Prometheus application metrics for HTTP success, HTTP latency, candidate request count, and SQS publish success.

Candidate metrics are scraped directly with a `PodMonitor` and should fail closed when samples are missing. k6 generates traffic and validation evidence, but Flagger makes rollout decisions from Prometheus.

The lab uses app `/metrics` instead of assuming kube-prometheus-stack automatically scrapes every Istio or Envoy metric required by Flagger.
This keeps the gates tied to the candidate API behavior, including SQS publish health.

## Why this fits the challenge

- Blue/Green uses synthetic candidate traffic before promotion.
- Canary uses progressive traffic and Prometheus gates.
- k6 makes validation visible.
- Local Kubernetes can prove both promotion and rollback.
- Documentation explains the difference between rollout gates and production SLOs.

## Consequences

### Positive

- Rollout decisions are based on candidate behavior.
- SQS publish failures can block promotion.
- Missing candidate traffic cannot accidentally look healthy.
- Rollback evidence is repeatable.
- Blue/Green and Canary reuse the same rollout metric templates.

### Tradeoffs

- Application metrics require careful label discipline.
- Pod-level candidate filtering is more precise but more coupled to rollout behavior.
- Local rollback can still hit mesh termination edge cases.
- k6 evidence does not replace production alerting.

## Alternatives considered

- Readiness probes only: useful, but not enough to detect degraded business behavior.
- Istio/Envoy metrics only: useful, but less direct for SQS publish health.
- k6-only gates: good test evidence, but the controller should use in-cluster metrics.
- Dashboard review only: visual, but not an automated rollout decision.

## Production evolution

Production would add service-level SLOs, alert routing, dashboard panels, trace correlation, and stronger graceful shutdown behavior. Rollout gates would remain separate from long-window SLO reporting.

## Takeaway

The lab treats metrics as release controls, not decoration.
