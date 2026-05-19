# ADR-001: Progressive delivery stack

## Context

The challenge is to demonstrate Blue/Green and Canary releases in local Kubernetes without hiding the rollout mechanics behind a full platform.

A financial product release needs more than “new pods are running”. The release path must control traffic, observe the candidate, and roll back when the candidate degrades user-visible behavior.

## Decision

The stack uses Istio for traffic management, Flagger for Blue/Green and Canary orchestration, and Prometheus for rollout analysis.

Flagger owns routing during Blue/Green and Canary. Istio header-routed preview remains optional evidence and is kept separate from Flagger-owned rollout scenarios.

## Why this fits the challenge

- Blue/Green deployment implementation is handled by Flagger promotion.
- Canary deployment strategy is handled by Flagger progressive traffic shifting.
- Documentation can explain who owns traffic at each step.
- The full path runs in local kind.
- k6 provides visible traffic during rollout validation.

## Consequences

### Positive

- The rollout controller, traffic plane, and metric source are explicit.
- Kubernetes resources remain inspectable instead of becoming a black box.
- The same stack supports promotion and rollback.

### Tradeoffs

- Istio, Flagger, and Prometheus add more moving parts than plain Kubernetes.
- Local setup is heavier than a simple Deployment/Service demo.
- Flagger ownership requires discipline: manual Istio routes must not overlap rollout routes.

## Alternatives considered

- Manual Kubernetes only: too much scripting, too little rollout control.
- NGINX ingress annotations: lighter, but weaker for the preview and traffic-shifting story.
- Argo Rollouts: valid, but adding it beside Flagger would duplicate rollout abstractions.
- Service mesh only without Flagger: traffic shifting works, but promotion and rollback become manual.
- Grafana/Kiali as required dependencies: useful, but not required for local validation.

## Production evolution

Production would add GitOps, stronger policy checks, multi-replica workloads, dashboards, alerting, and environment promotion rules. The rollout controller should still have clear ownership of traffic during analysis.

## Takeaway

The lab chooses one progressive delivery control loop and keeps ownership clear. The goal is safe rollout behavior, not a pile of Kubernetes tools.
