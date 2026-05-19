# Manual Flow

Use this path if you want to reproduce the recorded demo step by step instead of running the full `make demo` target.

Run from the repository root. Use two terminals when a watch or port-forward is needed:

- Terminal A: commands
- Terminal B: watch/status or port-forward

## Clean Setup

```bash
make clean
make setup
```

Check the local cluster state:

```bash
kubectl get pods -A
kubectl -n belo get deploy,svc
kubectl -n ministack get deploy,svc,job
```

After `make setup`, only the core app is deployed. There is no Istio `Gateway`, `VirtualService`, or Flagger `Canary` yet, so validate v1 directly with a temporary port-forward.

Terminal B:

```bash
kubectl -n belo port-forward svc/transaction-api 18080:3000
```

Terminal A:

```bash
LOAD_TARGET_URL=http://127.0.0.1:18080 make validate-v1
```

Stop the port-forward with `Ctrl-C` before continuing.

## Blue/Green

Flagger names the stable workload `primary` and the candidate path `canary`. In this scenario, `transaction-api-primary` is Blue, and `transaction-api-canary` is the isolated Green validation service.

Terminal A:

```bash
kubectl apply -k deploy/app/overlays/bluegreen
kubectl -n belo wait --for=create deployment/transaction-api-primary --timeout=180s
```

Terminal B:

```bash
kubectl -n belo get canary/transaction-api -w
```

Terminal A:

```bash
kubectl -n belo set env deployment/transaction-api SERVICE_VERSION=v2 GIT_COMMIT=bluegreen-$(date +%s)
kubectl -n belo rollout status deployment/transaction-api --timeout=180s
kubectl -n belo wait --for=create svc/transaction-api-canary --timeout=180s
```

Send isolated validation traffic to Green.

Terminal B:

```bash
kubectl -n belo port-forward svc/transaction-api-canary 18081:3000
```

Terminal A:

```bash
TARGET_URL=http://127.0.0.1:18081 k6 run tests/k6/bluegreen-candidate-load.js
```

Stop the Green port-forward with `Ctrl-C` after k6 finishes.

Promote and validate through the Istio Gateway:

```bash
kubectl -n belo wait canary/transaction-api --for=condition=promoted --timeout=8m
EXPECTED_VERSION=v2 TARGET_URL=http://127.0.0.1:8080 VALIDATE_ATTEMPTS=30 VALIDATE_SLEEP_SECONDS=2 k6 run tests/k6/version-validate.js
```

Expected Flagger status path:

```text
Initialized -> Progressing -> Promoting -> Finalising -> Succeeded
```

Stop the watch in Terminal B with `Ctrl-C` before continuing.

## Canary

This can run after Blue/Green or directly after `make setup`. `make scenario-clean` only removes optional scenario resources if they exist.

Terminal A:

```bash
make scenario-clean
kubectl apply -k deploy/app/overlays/canary
kubectl -n belo wait --for=create canary/transaction-api --timeout=60s
kubectl -n belo wait --for=create deployment/transaction-api-primary --timeout=180s
kubectl -n belo rollout status deployment/transaction-api --timeout=180s
kubectl -n belo rollout status deployment/transaction-api-primary --timeout=180s
```

Terminal B:

```bash
kubectl -n belo get canary/transaction-api -w
```

Terminal A:

```bash
EXPECTED_VERSION=v1 TARGET_URL=http://127.0.0.1:8080 VALIDATE_ATTEMPTS=30 VALIDATE_SLEEP_SECONDS=2 k6 run tests/k6/version-validate.js
kubectl -n belo set env deployment/transaction-api SERVICE_VERSION=v2 GIT_COMMIT=canary-$(date +%s)
kubectl -n belo rollout status deployment/transaction-api --timeout=180s
```

Send Gateway traffic while Flagger shifts traffic to the candidate:

```bash
LOAD_DURATION=180s TARGET_URL=http://127.0.0.1:8080 k6 run tests/k6/canary-promotion-load.js
```

Wait for promotion and validate v2:

```bash
kubectl -n belo wait canary/transaction-api --for=condition=promoted --timeout=8m
kubectl -n belo get canary transaction-api
EXPECTED_VERSION=v2 TARGET_URL=http://127.0.0.1:8080 VALIDATE_ATTEMPTS=30 VALIDATE_SLEEP_SECONDS=2 k6 run tests/k6/version-validate.js
```

Expected Flagger status path:

```text
Initialized -> Progressing 25 -> Progressing 50 -> Promoting -> Finalising -> Succeeded
```

Stop the watch in Terminal B with `Ctrl-C` when finished.

## Optional Checks

Preview and rollback are optional evidence scenarios. The Make targets are intentionally used here because they include cleanup and validation without hiding core Blue/Green or Canary behavior.

```bash
make preview
make rollback
```

If you get lost:

```bash
make status
kubectl -n belo get canary transaction-api -o wide
kubectl -n belo describe canary transaction-api
kubectl -n belo get pods,svc,endpoints,virtualservice,destinationrule
```

Reset only scenario resources:

```bash
make scenario-clean
```

Full cleanup:

```bash
make clean
```
