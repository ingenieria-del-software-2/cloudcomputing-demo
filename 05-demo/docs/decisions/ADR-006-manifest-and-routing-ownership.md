# ADR-006: Manifest and routing ownership

## Context

The lab uses both third-party infrastructure and lab-owned application manifests. Mixing ownership makes local environments harder to debug.

Traffic ownership is especially important. If manual Istio resources and Flagger-generated resources compete, rollout behavior becomes flaky.

## Decision

Helm installs third-party infrastructure. Kustomize composes lab-owned application manifests and scenario overlays.

Flagger owns routing during Blue/Green and Canary. Manual Istio preview routing exists only in the preview scenario and must be cleaned up before Flagger-owned rollouts.

Shared rollout analysis resources live in `deploy/app/base/rollout`. The Blue/Green and Canary overlays consume that Kustomize base instead of duplicating `MetricTemplate` files or referencing files from sibling overlays.

The core overlay should stay scenario-free. Scenario overlays add only what that scenario needs.

## Why this fits the challenge

- Local Kubernetes resources remain inspectable.
- Overlays remain renderable with `kubectl kustomize`.
- Blue/Green and Canary ownership stays clear.
- Optional preview does not pollute the core demo.
- The Makefile can remain the simple public entrypoint.

## Consequences

### Positive

- Clear split between infrastructure and application resources.
- Scenario overlays are easier to review.
- Flagger and manual Istio routes do not silently fight.
- Shared rollout gates stay consistent across Blue/Green and Canary.
- Optional evidence stays optional.

### Tradeoffs

- The repo uses two manifest tools.
- Scenario cleanup must be careful.
- Kustomize overlays can drift if not rendered in CI or local checks.
- Emergency routing requires understanding Flagger ownership first.

## Alternatives considered

- Helm chart for the app: less transparent for a small lab.
- Kustomize rendering Helm charts: blends responsibilities.
- Helmfile: another layer for a local challenge.
- Argo CD: useful in production, extra moving part locally.
- Manual VirtualService edits during canary: unsafe while Flagger is active.
- Sibling file references between overlays: brittle and blocked by Kustomize path safety.

## Production evolution

Production would likely use GitOps, policy checks, promoted environments, and stronger ownership boundaries. If this becomes an internal platform, release intent should be declared while the platform owns the generated Flagger, Istio, Prometheus, and Kustomize resources. Manual emergency changes should be audited and reconciled back into the declared state.

## Takeaway

The lab keeps the control plane boring on purpose: one tool owns infra, one tool owns app manifests, and Flagger owns rollout traffic.
