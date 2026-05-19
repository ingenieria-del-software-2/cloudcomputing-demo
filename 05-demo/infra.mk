.PHONY: \
	kind-create kind-create-if-needed kind-delete kind-delete-if-needed kind-load-images \
	k8s-install-prometheus k8s-install-istio k8s-install-flagger \
	k8s-render-core k8s-apply-core \
	k8s-render-preview k8s-apply-preview preview-clean flagger-clean scenario-clean preview-deploy preview-wait preview-validate \
	k8s-render-bluegreen k8s-apply-bluegreen bluegreen-clean bluegreen-deploy bluegreen-trigger bluegreen-wait-candidate bluegreen-candidate-load bluegreen-wait-success bluegreen-validate \
	k8s-render-canary k8s-apply-canary canary-clean canary-deploy canary-start canary-load canary-wait-ready canary-wait-success \
	k8s-render-rollback k8s-apply-rollback rollback-reset rollback-break-v2 rollback-load rollback-wait-failed validate-v1 validate-v2 \
	k6-smoke k6-preview-validate k6-version-validate k6-bluegreen-candidate-load k6-canary-promotion-load k6-rollback-load k6-canary-promotion-dashboard k6-rollback-dashboard

# --- Kubernetes / Kind ---
kind-create:
	kind create cluster --config deploy/cluster/kind/cluster.yaml

kind-create-if-needed:
	@set -euo pipefail; \
	if kind get clusters | grep -qx belo-local; then \
		printf '%s\n' 'kind cluster belo-local already exists'; \
	else \
		kind create cluster --config deploy/cluster/kind/cluster.yaml; \
	fi

kind-delete:
	kind delete cluster --name belo-local

kind-delete-if-needed:
	@set -euo pipefail; \
	if kind get clusters | grep -qx belo-local; then \
		kind delete cluster --name belo-local; \
	else \
		printf '%s\n' 'kind cluster belo-local does not exist'; \
	fi

kind-load-images:
	kind load docker-image --name belo-local transaction-api:local ledger-service:local receipt-worker:local

k8s-install-prometheus:
	$(HELM) repo add prometheus-community https://prometheus-community.github.io/helm-charts --force-update
	$(HELM) repo update
	$(HELM) upgrade --install $(PROMETHEUS_RELEASE) prometheus-community/kube-prometheus-stack \
		--namespace $(PROMETHEUS_NAMESPACE) \
		--create-namespace \
		--set grafana.enabled=false \
		--set alertmanager.enabled=false \
		--set kubeStateMetrics.enabled=false \
		--set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false \
		--set prometheus.prometheusSpec.serviceMonitorNamespaceSelectorNilUsesHelmValues=false \
		--set prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues=false \
		--set prometheus.prometheusSpec.podMonitorNamespaceSelectorNilUsesHelmValues=false \
		--wait \
		--timeout 10m

k8s-install-istio:
	$(HELM) repo add istio https://istio-release.storage.googleapis.com/charts --force-update
	$(HELM) repo update
	kubectl create namespace $(ISTIO_NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -
	$(HELM) upgrade --install istio-base istio/base \
		--namespace $(ISTIO_NAMESPACE) \
		--version $(ISTIO_VERSION) \
		--set defaultRevision=default \
		--wait \
		--timeout 10m
	$(HELM) upgrade --install istiod istio/istiod \
		--namespace $(ISTIO_NAMESPACE) \
		--version $(ISTIO_VERSION) \
		--wait \
		--timeout 10m
	kubectl create namespace $(ISTIO_INGRESS_NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -
	$(HELM) upgrade --install $(ISTIO_INGRESS_RELEASE) istio/gateway \
		--namespace $(ISTIO_INGRESS_NAMESPACE) \
		--version $(ISTIO_VERSION) \
		-f deploy/infra/istio/helm-values/gateway.yaml \
		--wait \
		--timeout 10m

k8s-install-flagger:
	$(HELM) repo add flagger https://flagger.app --force-update
	$(HELM) repo update
	kubectl apply -f https://raw.githubusercontent.com/fluxcd/flagger/v$(FLAGGER_VERSION)/artifacts/flagger/crd.yaml
	$(HELM) upgrade --install $(FLAGGER_RELEASE) flagger/flagger \
		--namespace $(FLAGGER_NAMESPACE) \
		--version $(FLAGGER_VERSION) \
		--set crd.create=false \
		--set meshProvider=istio \
		--set metricsServer=http://$(PROMETHEUS_RELEASE)-prometheus.$(PROMETHEUS_NAMESPACE):9090 \
		--wait \
		--timeout 10m

k8s-render-core:
	kubectl kustomize deploy/app/overlays/core

k8s-apply-core:
	kubectl apply -k deploy/app/overlays/core

k8s-render-preview:
	kubectl kustomize deploy/app/overlays/preview

k8s-apply-preview:
	kubectl apply -k deploy/app/overlays/preview

k8s-render-bluegreen:
	kubectl kustomize deploy/app/overlays/bluegreen

k8s-apply-bluegreen:
	kubectl apply -k deploy/app/overlays/bluegreen

k8s-render-canary:
	kubectl kustomize deploy/app/overlays/canary

k8s-apply-canary:
	kubectl apply -k deploy/app/overlays/canary

k8s-render-rollback:
	kubectl kustomize deploy/app/overlays/rollback

k8s-apply-rollback:
	kubectl apply -k deploy/app/overlays/rollback

preview-clean:
	kubectl delete virtualservice transaction-api-preview -n belo --ignore-not-found --wait=false
	kubectl delete gateway transaction-api -n belo --ignore-not-found --wait=false
	kubectl delete servicemonitor transaction-api-preview -n belo --ignore-not-found --wait=false
	kubectl delete service transaction-api-preview -n belo --ignore-not-found --wait=false
	kubectl delete deployment transaction-api-preview -n belo --ignore-not-found --wait=false

flagger-clean:
	kubectl delete canary transaction-api -n belo --ignore-not-found --wait=true --timeout=120s
	kubectl delete virtualservice transaction-api -n belo --ignore-not-found --wait=false
	kubectl delete destinationrule transaction-api -n belo --ignore-not-found --wait=false
	kubectl delete destinationrule transaction-api-canary -n belo --ignore-not-found --wait=false
	kubectl delete destinationrule transaction-api-primary -n belo --ignore-not-found --wait=false
	kubectl delete service transaction-api-canary -n belo --ignore-not-found --wait=false
	kubectl delete service transaction-api-primary -n belo --ignore-not-found --wait=false
	kubectl delete deployment transaction-api-primary -n belo --ignore-not-found --wait=false

scenario-clean: preview-clean flagger-clean

preview-deploy: scenario-clean k8s-apply-preview

preview-wait:
	kubectl -n belo rollout status deployment/transaction-api --timeout=180s
	kubectl -n belo rollout status deployment/transaction-api-preview --timeout=180s

preview-validate: k6-preview-validate
	@printf '%b\n' '$(LOG_OK) Preview validation passed: normal traffic is v1, header-routed traffic is v2.'

bluegreen-clean: scenario-clean

bluegreen-deploy: bluegreen-clean k8s-apply-bluegreen
	kubectl -n belo wait --for=create canary/transaction-api --timeout=60s

bluegreen-trigger:
	@$(MAKE) canary-wait-ready
	@stamp=$$(date +%s); \
	kubectl -n belo set env deployment/transaction-api SERVICE_VERSION=v2 GIT_COMMIT=bluegreen-$$stamp SQS_PUBLISH_FAILURE_MODE- ERROR_RATE- ERROR_TYPE- ERROR_CODE- ERROR_DELAY- TIMING_50_PERCENTILE- TIMING_90_PERCENTILE- TIMING_99_PERCENTILE- TIMING_VARIANCE-

bluegreen-wait-candidate:
	kubectl -n belo wait --for=create service/transaction-api-canary --timeout=180s
	kubectl -n belo wait --for=jsonpath='{.subsets[0].addresses[0].ip}' endpoints/transaction-api-canary --timeout=180s
	kubectl -n belo get service transaction-api-canary
	kubectl -n belo get endpoints transaction-api-canary

bluegreen-candidate-load:
	@set -euo pipefail; \
	pf_log=$$(mktemp "$${TMPDIR:-/tmp}/belo-bluegreen-canary-port-forward.XXXXXX.log"); \
	kubectl -n belo port-forward svc/transaction-api-canary $(BLUEGREEN_CANARY_LOCAL_PORT):3000 >"$$pf_log" 2>&1 & \
	pf_pid=$$!; \
	trap 'kill $$pf_pid >/dev/null 2>&1 || true; wait $$pf_pid 2>/dev/null || true; rm -f "$$pf_log"' EXIT; \
	if ! $(CURL) --retry 30 --retry-delay 1 --retry-connrefused --retry-all-errors --max-time 2 -fsS http://127.0.0.1:$(BLUEGREEN_CANARY_LOCAL_PORT)/readyz >/dev/null 2>&1; then \
		printf 'port-forward to transaction-api-canary did not become ready; log: %s\n' "$$pf_log"; \
		exit 1; \
	fi; \
	env -u K6_DURATION -u K6_RATE -u K6_PRE_ALLOCATED_VUS -u K6_MAX_VUS -u K6_RECOVERY_SLEEP_SECONDS TARGET_URL="http://127.0.0.1:$(BLUEGREEN_CANARY_LOCAL_PORT)" LOAD_RATE="$(BLUEGREEN_LOAD_RATE)" LOAD_DURATION="$(BLUEGREEN_LOAD_DURATION)" LOAD_PRE_ALLOCATED_VUS="$(BLUEGREEN_LOAD_PRE_ALLOCATED_VUS)" LOAD_MAX_VUS="$(BLUEGREEN_LOAD_MAX_VUS)" $(K6) run tests/k6/bluegreen-candidate-load.js

bluegreen-wait-success:
	@set -euo pipefail; \
	if [ "$${WATCH_CANARY_STATUS:-1}" = "1" ]; then \
		printf '%b\n' '$(LOG_STEP) Watching Flagger canary status while waiting for promotion:'; \
		kubectl -n belo get canary/transaction-api -w & \
		watch_pid=$$!; \
		trap 'kill $$watch_pid >/dev/null 2>&1 || true; wait $$watch_pid 2>/dev/null || true' EXIT; \
	fi; \
	if ! kubectl -n belo wait canary/transaction-api --for=condition=promoted --timeout=8m; then \
		kubectl -n belo get canary transaction-api -o wide || true; \
		kubectl -n belo describe canary transaction-api || true; \
		kubectl -n belo get pods,svc,endpoints,virtualservice,destinationrule || true; \
		exit 1; \
	fi
	@kubectl -n belo get canary transaction-api

bluegreen-validate:
	VALIDATE_ATTEMPTS=30 VALIDATE_SLEEP_SECONDS=2 $(MAKE) validate-v2
	@printf '%b\n' '$(LOG_OK) Blue/Green validation passed: normal traffic reached Green v2 through Istio Gateway.'

canary-clean: scenario-clean

canary-deploy: canary-clean k8s-apply-canary

canary-start: canary-deploy
	@$(MAKE) canary-wait-ready
	@stamp=$$(date +%s); \
	kubectl -n belo set env deployment/transaction-api SERVICE_VERSION=v2 GIT_COMMIT=canary-$$stamp; \
	kubectl -n belo rollout status deployment/transaction-api --timeout=180s

canary-load:
	LOAD_DURATION=180s $(MAKE) k6-canary-promotion-load

canary-wait-ready:
	kubectl -n belo wait --for=create deployment/transaction-api --timeout=60s
	kubectl -n belo wait --for=create deployment/transaction-api-primary --timeout=180s
	kubectl -n belo wait deployment/transaction-api --for=condition=Available --timeout=180s
	kubectl -n belo wait deployment/transaction-api-primary --for=condition=Available --timeout=180s
	EXPECTED_VERSION=v1 VALIDATE_ATTEMPTS=30 VALIDATE_SLEEP_SECONDS=2 $(MAKE) k6-version-validate

canary-wait-success:
	@set -euo pipefail; \
	if [ "$${WATCH_CANARY_STATUS:-1}" = "1" ]; then \
		printf '%b\n' '$(LOG_STEP) Watching Flagger canary status while waiting for promotion:'; \
		kubectl -n belo get canary/transaction-api -w & \
		watch_pid=$$!; \
		trap 'kill $$watch_pid >/dev/null 2>&1 || true; wait $$watch_pid 2>/dev/null || true' EXIT; \
	fi; \
	if ! kubectl -n belo wait canary/transaction-api --for=condition=promoted --timeout=8m; then \
		kubectl -n belo get canary transaction-api -o wide || true; \
		kubectl -n belo describe canary transaction-api || true; \
		kubectl -n belo get pods,svc,endpoints,virtualservice,destinationrule || true; \
		exit 1; \
	fi
	@kubectl -n belo get canary transaction-api

rollback-reset: canary-clean k8s-apply-canary
	@set -euo pipefail; \
	kubectl -n belo wait --for=create deployment/transaction-api-primary --timeout=180s; \
	stamp=$$(date +%s); \
	kubectl -n belo set env deployment/transaction-api SERVICE_VERSION=v1 GIT_COMMIT=rollback-baseline-$$stamp SQS_PUBLISH_FAILURE_MODE- ERROR_RATE- ERROR_TYPE- ERROR_CODE- ERROR_DELAY- TIMING_50_PERCENTILE- TIMING_90_PERCENTILE- TIMING_99_PERCENTILE- TIMING_VARIANCE-; \
	kubectl -n belo set env deployment/transaction-api-primary SERVICE_VERSION=v1 GIT_COMMIT=rollback-baseline-$$stamp SQS_PUBLISH_FAILURE_MODE- ERROR_RATE- ERROR_TYPE- ERROR_CODE- ERROR_DELAY- TIMING_50_PERCENTILE- TIMING_90_PERCENTILE- TIMING_99_PERCENTILE- TIMING_VARIANCE-; \
	kubectl -n belo rollout status deployment/transaction-api --timeout=180s; \
	kubectl -n belo rollout status deployment/transaction-api-primary --timeout=180s
	@$(MAKE) canary-wait-ready

rollback-break-v2: preview-clean k8s-apply-rollback
	@stamp=$$(date +%s); \
	kubectl -n belo set env deployment/transaction-api SERVICE_VERSION=v2 GIT_COMMIT=rollback-$$stamp ERROR_RATE=10 ERROR_CODE=500; \
	kubectl -n belo rollout status deployment/transaction-api --timeout=180s

validate-v1:
	EXPECTED_VERSION=v1 $(MAKE) k6-version-validate

validate-v2:
	EXPECTED_VERSION=v2 $(MAKE) k6-version-validate

rollback-load: k6-rollback-load

rollback-wait-failed:
	@set -euo pipefail; \
	if [ "$${WATCH_CANARY_STATUS:-1}" = "1" ]; then \
		printf '%b\n' '$(LOG_STEP) Watching Flagger canary status while waiting for rollback failure state:'; \
		kubectl -n belo get canary/transaction-api -w & \
		watch_pid=$$!; \
		trap 'kill $$watch_pid >/dev/null 2>&1 || true; wait $$watch_pid 2>/dev/null || true' EXIT; \
	fi; \
	kubectl -n belo wait canary/transaction-api --for=jsonpath='{.status.phase}'=Failed --timeout=10m
	@kubectl -n belo get canary transaction-api

k6-smoke:
	EXPECTED_VERSION=v1 $(MAKE) k6-version-validate

k6-preview-validate:
	env -u K6_DURATION -u K6_RATE -u K6_PRE_ALLOCATED_VUS -u K6_MAX_VUS -u K6_RECOVERY_SLEEP_SECONDS TARGET_URL="$(LOAD_TARGET_URL)" $(K6) run tests/k6/preview-validate.js

k6-version-validate:
	env -u K6_DURATION -u K6_RATE -u K6_PRE_ALLOCATED_VUS -u K6_MAX_VUS -u K6_RECOVERY_SLEEP_SECONDS TARGET_URL="$(LOAD_TARGET_URL)" EXPECTED_VERSION="$(EXPECTED_VERSION)" VALIDATE_ATTEMPTS="$(VALIDATE_ATTEMPTS)" VALIDATE_SLEEP_SECONDS="$(VALIDATE_SLEEP_SECONDS)" $(K6) run tests/k6/version-validate.js

k6-bluegreen-candidate-load:
	env -u K6_DURATION -u K6_RATE -u K6_PRE_ALLOCATED_VUS -u K6_MAX_VUS -u K6_RECOVERY_SLEEP_SECONDS TARGET_URL="http://127.0.0.1:$(BLUEGREEN_CANARY_LOCAL_PORT)" LOAD_RATE="$(BLUEGREEN_LOAD_RATE)" LOAD_DURATION="$(BLUEGREEN_LOAD_DURATION)" LOAD_PRE_ALLOCATED_VUS="$(BLUEGREEN_LOAD_PRE_ALLOCATED_VUS)" LOAD_MAX_VUS="$(BLUEGREEN_LOAD_MAX_VUS)" $(K6) run tests/k6/bluegreen-candidate-load.js

k6-canary-promotion-load:
	env -u K6_DURATION -u K6_RATE -u K6_PRE_ALLOCATED_VUS -u K6_MAX_VUS -u K6_RECOVERY_SLEEP_SECONDS TARGET_URL="$(LOAD_TARGET_URL)" LOAD_RATE="$(LOAD_RATE)" LOAD_DURATION="$(LOAD_DURATION)" LOAD_PRE_ALLOCATED_VUS="$(LOAD_PRE_ALLOCATED_VUS)" LOAD_MAX_VUS="$(LOAD_MAX_VUS)" $(K6) run tests/k6/canary-promotion-load.js

k6-rollback-load:
	env -u K6_DURATION -u K6_RATE -u K6_PRE_ALLOCATED_VUS -u K6_MAX_VUS -u K6_RECOVERY_SLEEP_SECONDS TARGET_URL="$(LOAD_TARGET_URL)" LOAD_RATE="$(LOAD_RATE)" LOAD_DURATION="$(ROLLBACK_LOAD_DURATION)" LOAD_PRE_ALLOCATED_VUS="$(LOAD_PRE_ALLOCATED_VUS)" LOAD_MAX_VUS="$(LOAD_MAX_VUS)" RECOVERY_SLEEP_SECONDS="$(ROLLBACK_RECOVERY_SLEEP_SECONDS)" $(K6) run tests/k6/rollback-load.js

k6-canary-promotion-dashboard:
	@mkdir -p "$(K6_REPORTS_DIR)"
	env -u K6_DURATION -u K6_RATE -u K6_PRE_ALLOCATED_VUS -u K6_MAX_VUS -u K6_RECOVERY_SLEEP_SECONDS K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT="$(K6_REPORTS_DIR)/k6-canary-promotion.html" TARGET_URL="$(LOAD_TARGET_URL)" LOAD_RATE="$(LOAD_RATE)" LOAD_DURATION="$(LOAD_DURATION)" LOAD_PRE_ALLOCATED_VUS="$(LOAD_PRE_ALLOCATED_VUS)" LOAD_MAX_VUS="$(LOAD_MAX_VUS)" $(K6) run tests/k6/canary-promotion-load.js

k6-rollback-dashboard:
	@mkdir -p "$(K6_REPORTS_DIR)"
	env -u K6_DURATION -u K6_RATE -u K6_PRE_ALLOCATED_VUS -u K6_MAX_VUS -u K6_RECOVERY_SLEEP_SECONDS K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT="$(K6_REPORTS_DIR)/k6-rollback.html" TARGET_URL="$(LOAD_TARGET_URL)" LOAD_RATE="$(LOAD_RATE)" LOAD_DURATION="$(ROLLBACK_LOAD_DURATION)" LOAD_PRE_ALLOCATED_VUS="$(LOAD_PRE_ALLOCATED_VUS)" LOAD_MAX_VUS="$(LOAD_MAX_VUS)" RECOVERY_SLEEP_SECONDS="$(ROLLBACK_RECOVERY_SLEEP_SECONDS)" $(K6) run tests/k6/rollback-load.js
