# Rollout Gates and SLOs

The demo uses local rollout gates, not production SLOs.

A production SLO describes user-facing reliability over time. A rollout gate is a short-window release decision: should this candidate receive more traffic, be promoted, or be rolled back?

## Flagger gates

Flagger reads Prometheus metrics from the application during Blue/Green and Canary analysis.

| Gate | Why it exists |
| --- | --- |
| Candidate request count | A candidate with no traffic should not be promoted by empty success metrics |
| HTTP success rate | Detects candidate 5xx responses |
| HTTP latency p95 | Detects slow candidates before promotion |
| SQS publish success | Ensures the API still publishes receipt work, not only HTTP responses |

The gates are intentionally small and local. They prove that the release controller can make a data-backed decision.

MiniStack is not scraped as the rollout signal. The important SQS signal is emitted by `transaction-api` when it publishes receipt commands.

Current implementation:

| Resource | Purpose |
| --- | --- |
| `deploy/app/base/rollout` | Shared Flagger `MetricTemplate` base used by Blue/Green and Canary |
| `podmonitor-transaction-api-canary.yaml` | Scrapes candidate pods directly during rollout analysis |
| `canary-transaction-api*.yaml` | References the shared templates by name from the Flagger `Canary` CR |

The templates query application metrics, not Istio sidecar metrics:

```text
http_requests_total
http_request_duration_seconds_bucket
sqs_publish_total
```

Other application metrics, such as `transactions_total`, remain useful diagnostics. They are not separate Flagger gates because HTTP success plus SQS publish success already cover the release decision.

The PromQL filters candidate pods with `pod=~"transaction-api-[^-]+-[^-]+$"`. Counters use two-minute windows and `increase(...)` so low local traffic does not make the analysis overly brittle.

## Fail-closed behavior

Metric queries should fail closed:

- missing candidate traffic should evaluate as unhealthy
- missing success samples should not look perfect
- missing latency samples should not look fast
- candidate metrics should not accidentally read primary metrics

The current templates use `clamp_min(...)` for denominators and `or vector(0)` / `or vector(999)` fallbacks so missing samples do not promote a candidate by accident.

The rollback scenario exists because this detail matters. A canary that receives no candidate traffic must not be promoted just because no errors were observed.

## Metrics discipline

Prometheus labels must stay low cardinality.

Good labels:

```text
service
version
status
route
method
```

Bad labels:

```text
request_id
transaction_id
operation_id
idempotency_key
```

IDs belong in structured logs, not metric labels.

## k6 role

k6 provides visible evidence and load generation. It is not the rollout controller.

The repo keeps k6 small: smoke/version, preview, Blue/Green candidate, healthy Canary, and rollback traffic.

k6 validates:

- stable API smoke behavior
- preview header routing
- Blue/Green candidate behavior
- healthy Canary behavior
- rollback and recovery behavior

Flagger still makes promotion and rollback decisions from Prometheus metrics.

## Rollback evidence

`make rollback` is optional evidence that the same Flagger control loop can fail safely. It resets traffic to stable v1, deploys a broken v2 candidate, runs rollback load, waits for Flagger to mark the rollout `Failed`, and validates recovery to v1.

During rollback load, some requests may reach broken v2 and return expected candidate failures. The important signal is that Prometheus observes the degradation, Flagger aborts the candidate, and normal traffic recovers to v1.

Investigate if:

- candidate traffic is missing but the candidate is promoted
- Prometheus reads primary metrics as candidate metrics
- recovery does not return to v1
- unexpected response statuses appear outside the rollback contract
- non-JSON mesh transition responses appear outside accepted pod-withdrawal timing

## Production SLO evolution

A production platform would define SLOs separately from rollout gates, for example:

- API availability
- API latency
- transaction acceptance error rate
- SQS publish reliability
- worker processing lag
- rollback time objective

Those SLOs would drive alerting and error budgets. The local demo keeps that out so the flow stays compact.
