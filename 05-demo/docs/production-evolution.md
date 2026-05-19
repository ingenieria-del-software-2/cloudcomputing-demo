# Production Evolution

The demo is intentionally small. A production financial platform would keep the release shape, but harden the state, traffic, and operational controls.

## Platform adoption

The adoptable product is not this repo, the Makefile, or the Kubernetes manifests. It is a paved road for safe service releases: declare intent, get Canary or Blue/Green rollout, see evidence, and roll back automatically without exposing Istio, Flagger, Prometheus, and Kustomize as required knowledge.

A production platform should expose a small service contract:

- health, readiness, and metrics endpoints
- `SERVICE_VERSION` and `GIT_COMMIT`
- standard labels
- low-cardinality HTTP or worker metrics

The platform should own the generated rollout resources, policies, dashboards, and notifications. Release intent should enter through a PR, a small CLI, or an internal portal template.

Adoption should be measured by outcomes: onboarded services, deploys using safe release, onboarding time, automatic aborts, rollback time, and release confidence.

The demo proves the control loop works. Productization should reduce cognitive load.

## Release management

Add GitOps after the local workflow is proven:

- Argo CD or another GitOps controller
- environment promotion through reviewed commits
- signed images and policy checks
- separate production configuration from local overlays

Argo Rollouts is a valid alternative to Flagger, but the lab uses one rollout controller to avoid duplicate abstractions.
Feature flags can complement traffic shifting for product exposure; the lab leaves them out because it validates release traffic, not feature targeting.

## State and messaging

If the transaction domain became durable, add:

- persistent idempotency storage
- durable ledger state
- transactional outbox for database-to-queue consistency
- managed SQS
- DLQ and replay procedures
- retention and audit storage separate from SQS

SQS should remain a work queue unless the product explicitly needs an event log.
These items are intentionally outside the demo; adding them would not make the local rollout proof stronger.

## Observability

Add:

- Grafana dashboards for rollout, API, SQS, and worker health
- Kiali for mesh debugging when useful
- OpenTelemetry traces across API, ledger, SQS publish, and worker consume
- alerting on SLOs, not only rollout gates

Grafana and Kiali are useful, but they should not be required to validate the local challenge.
Prometheus remains the rollout decision source; dashboards are supporting evidence.

## Runtime hardening

Production should not rely on one replica.

Add:

- multiple replicas
- PodDisruptionBudgets
- graceful shutdown in application code
- readiness changes before termination
- stricter resource requests and limits
- network policies
- secrets management
- image vulnerability scanning

The lab keeps one replica because it makes rollout behavior easier to watch locally.

## Operational controls

Keep automatic rollback as the primary safety path. Manual emergency recovery is a production concern and must handle ownership carefully when Flagger is active.

Manual routing changes without suspending or reconciling Flagger can create two controllers fighting over the same traffic resources. Any emergency change should be audited and reconciled back into declared state.
