# kind local cluster

This config creates the local Kubernetes substrate for the demo.

```sh
kind create cluster --config deploy/cluster/kind/cluster.yaml
```

Use the public Makefile API from the repository root:

```sh
make doctor
make setup
make demo
make bluegreen
make canary
make preview
make rollback
make clean
```

`make setup` builds and loads local images, creates the `belo-local` kind cluster if needed, installs Prometheus/Istio/Flagger, and applies the `core` overlay.

The cluster maps host port `8080` to the Istio ingress NodePort `30080`.

Lower-level `infra.mk` targets exist for maintainer diagnostics, but the public demo flow should prefer `make demo` over partial target sequences. `make bluegreen` and `make canary` are available when setup has already completed. `make preview` and `make rollback` are optional evidence scenarios.

`make demo` is the core demo flow: setup, Flagger-owned Blue/Green promotion, then a healthy Flagger Canary promotion. Blue/Green keeps normal Istio Gateway traffic on Blue v1 while external k6 sends synthetic traffic to Green v2 through a local port-forward to `transaction-api-canary`; Canary uses external k6 load while Flagger progressively shifts Gateway traffic.

The canary overlay scrapes the candidate pod directly with a `PodMonitor` and fail-closed MetricTemplates. This keeps missing candidate samples or stale primary samples from being interpreted as a healthy rollout.

k6 traffic tests are wrapped by the public demo targets. The direct `k6-*` targets are available for diagnostics and dashboard export into `reports/`, which is ignored by git. Defaults are intentionally small for kind. Increase `LOAD_RATE`, `LOAD_DURATION`, `BLUEGREEN_LOAD_DURATION`, `ROLLBACK_LOAD_DURATION`, `LOAD_PRE_ALLOCATED_VUS`, and `LOAD_MAX_VUS` only for heavier diagnostic traffic.

Rollback dashboard metrics are k6 client-side evidence. `rollback_load_202_responses` confirms stable traffic, `rollback_load_500_responses` confirms the broken candidate was reached, and `rollback_out_of_contract_status == 0` confirms no status outside `202`/`500` appeared during the failure window.

Without app-level shutdown code or `preStop`, zero transient 503s during termination cannot be guaranteed. The `transaction-api` manifest keeps the lab at 1 replica and uses an infrastructure-only mitigation: `terminationGracePeriodSeconds: 45` plus Istio `terminationDrainDuration: 15s` to reduce the window where terminating candidate endpoints receive traffic.

`make rollback` generates failure-window traffic, waits for `canary/transaction-api` to reach `Failed`, and performs the final v1 recovery check.
