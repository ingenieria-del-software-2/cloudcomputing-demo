# Runtime Baseline

Core demo remeasured locally on Wed May 06 2026 with the public demo API. These are baselines, not guarantees; exact times depend on Docker cache, kind state, and Prometheus scrape timing.

## Summary

| Flow | Command | Time | Notes |
| --- | --- | ---: | --- |
| Core demo flow | `make demo` | 12m 38.55s | Clean end-to-end run after `make clean`; includes setup, Flagger Blue/Green promotion, and healthy Flagger Canary promotion with status streaming. |
| Optional preview evidence | `make preview` | 13.85s | Header-routed v2 preview while normal traffic stayed on v1. |
| Optional rollback proof | `make rollback` | 3m 10.65s | Flagger aborted a broken v2 candidate, k6 saw `783` stable `202` and `117` broken-candidate `500` responses, then recovered traffic to v1. |
| Cleanup | `make clean` | 4.93s | Cluster deleted before the cold demo run. |

The cold `make demo` run is the authoritative core demo timing because Flagger Blue/Green and Canary analysis both depend on live Prometheus scrape windows.

## Current Expected Runtime

| Path | Expected Time |
| --- | ---: |
| Cold start, no cluster | About 12 to 13.5 minutes |
| Already set up, core Blue/Green + Canary | About 10.5 to 12 minutes |
| Optional preview evidence | About 14 seconds |
| Optional rollback proof | About 3.2 minutes |

## Timing Drivers

| Priority | Area | Current Cost | Why It Costs Time |
| ---: | --- | ---: | --- |
| 1 | Blue/Green analysis | 270s candidate load plus promotion/finalization | `make bluegreen` lets Flagger own a full promotion while k6 sends isolated traffic to `transaction-api-canary` through a local port-forward. |
| 2 | Canary load | 180s minimum | `canary-load` forces `LOAD_DURATION=180s` so Flagger has enough Prometheus samples to promote reliably from a cold cluster. |
| 3 | Rollback load and recovery | 90s load plus 45s recovery pause | The recovery pause avoids validating while Flagger is still withdrawing broken candidate endpoints. |
| 4 | Flagger analysis windows | Fixed 30s intervals | Blue/Green, Canary, and rollback decisions wait for Prometheus-backed Flagger analysis rather than only client-side k6 success. |
| 5 | Setup | Around 80s | Builds images, creates kind, loads images, and installs Prometheus, Istio, and Flagger. |
| 6 | Preview | Around 15s | Mostly rollout wait plus one route validation pass. |

## Reliability Fixes Found While Timing

| Issue | Symptom | Fix |
| --- | --- | --- |
| Preview route propagation | Header-routed validation can start before the preview route is accepted by the gateway. | `make preview` waits for both deployments and validates normal v1 plus header-routed v2 traffic with k6. |
| Canary route readiness race | Initial k6 traffic received ingress `404` non-JSON responses. | Added `canary-wait-ready` before starting canary traffic. |
| Stale Flagger resources | Reruns could inherit previous canary state. | `canary-clean` now removes Flagger-managed canary routing resources before redeploying. |
| Blue/Green ownership split | Manual Blue/Green routing would compete with Flagger-managed Istio resources. | `make bluegreen` uses a Flagger `Canary` with `analysis.iterations` and external k6 synthetic traffic via `kubectl port-forward`; no manual Green service route is part of the core flow. |
| Healthy canary Prometheus gap | Early Flagger intervals could report `transaction-api-canary-request-rate` as `0.00` despite successful k6 traffic while Prometheus discovered and scraped the candidate pod. | Healthy canary uses a 180s load, two-minute Prometheus windows, and `threshold: 4`; k6 also requires at least one tagged `canary_promotion_responses{version:v2}` sample. |
| Rollback endpoint withdrawal race | k6 could see transient non-JSON `503 no healthy upstream` responses from Istio while Flagger aborted the broken candidate. | Rollback uses `ROLLBACK_LOAD_DURATION=90s`, `ROLLBACK_RECOVERY_SLEEP_SECONDS=45`, and allows only that specific mesh transition response while existing `http_req_failed` and `checks` thresholds bound repeated occurrences. |
| Makefile dry-run mutation risk | `make -n rollback` executed a long mutating shell line. | Split the recursive `$(MAKE) canary-wait-ready` call onto its own recipe line. |
| Blue/Green port-forward lifetime | Splitting `bluegreen-candidate-load` before k6 caused the shell `EXIT` trap to kill `kubectl port-forward` before traffic started, producing `connection refused` and `transaction-api-canary-request-rate 0.00 < 1`. | Keep candidate k6 in the same shell as the port-forward and wait after cleanup so the expected port-forward shutdown stays quiet. |
| Blue/Green candidate scrape window | Short candidate load could finish before Flagger saw enough Prometheus samples; overly long load could continue after promotion removed the candidate service. | `BLUEGREEN_LOAD_DURATION=270s` keeps candidate traffic alive across analysis windows without outliving the Flagger promotion. |

## Optimization Notes

Do not shorten the Blue/Green or Canary load durations without rerunning the full flow. Shorter loads were less reliable from a cold start because Flagger/Prometheus occasionally missed the candidate request-rate sample.
