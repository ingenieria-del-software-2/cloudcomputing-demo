SHELL := /bin/bash
.DEFAULT_GOAL := help

PNPM_VERSION ?= 10.30.0
PNPM ?= corepack pnpm@$(PNPM_VERSION)
GO ?= go
DOCKER ?= docker
COMPOSE ?= docker compose
CURL ?= curl
HELM ?= helm
K6 ?= k6

NO_COLOR ?=
ifeq ($(NO_COLOR),)
LOG_STEP := \033[1;36m==>\033[0m
LOG_OK := \033[1;32mOK\033[0m
LOG_WARN := \033[1;33mEXPECTED\033[0m
else
LOG_STEP := ==>
LOG_OK := OK
LOG_WARN := EXPECTED
endif

GO_LINT_IMAGE ?= golangci/golangci-lint:v2.12.1
TRANSACTION_API_DIR := services/transaction-api
RECEIPT_WORKER_DIR := services/receipt-worker
ORDER_MANAGEMENT_DIR := services/order-management
FULFILLMENT_PLANNING_DIR := services/fulfillment-planning
SHIPMENT_PREPARATION_DIR := services/shipment-preparation
TS_SERVICE_DIRS := $(TRANSACTION_API_DIR) $(RECEIPT_WORKER_DIR) $(ORDER_MANAGEMENT_DIR) $(FULFILLMENT_PLANNING_DIR) $(SHIPMENT_PREPARATION_DIR)
LEDGER_SERVICE_DIR := services/ledger-service
LEDGER_BASE_URL ?= http://127.0.0.1:3001
MINISTACK_ENDPOINT ?= http://localhost:4566
SQS_QUEUE_URL ?= http://localhost:4566/000000000000/receipt-commands
ORDERS_CONFIRMED_QUEUE_URL ?= http://localhost:4566/000000000000/orders-confirmed-intake
FULFILLMENT_COMMITMENT_QUEUE_URL ?= http://localhost:4566/000000000000/fulfillment-commitment-intake
BUYER_TRACKING_QUEUE_URL ?= http://localhost:4566/000000000000/buyer-tracking-events
ORDER_DATABASE_URL ?= postgresql://order:order@localhost:15432/order_management
FULFILLMENT_DATABASE_URL ?= postgresql://fulfillment:fulfillment@localhost:15433/fulfillment_planning
SHIPMENT_DATABASE_URL ?= postgresql://shipment:shipment@localhost:15434/shipment_preparation
SHIPMENT_DOCUMENTS_BUCKET ?= seller-dispatch-documents-lab
TRANSACTION_API_URL ?= http://localhost:3000
ORDER_MANAGEMENT_URL ?= http://localhost:3010
FULFILLMENT_PLANNING_URL ?= http://localhost:3020
SHIPMENT_PREPARATION_URL ?= http://localhost:3030
PROMETHEUS_URL ?= http://localhost:19090
PROMETHEUS_RELEASE ?= kube-prometheus-stack
PROMETHEUS_NAMESPACE ?= monitoring
ISTIO_VERSION ?= 1.29.0
ISTIO_NAMESPACE ?= istio-system
ISTIO_INGRESS_NAMESPACE ?= istio-ingress
ISTIO_INGRESS_RELEASE ?= istio-ingress
ISTIO_GATEWAY_URL ?= http://127.0.0.1:8080
FLAGGER_NAMESPACE ?= istio-system
FLAGGER_RELEASE ?= flagger
FLAGGER_VERSION ?= 1.43.0
LOAD_TARGET_URL ?= $(ISTIO_GATEWAY_URL)
LOAD_RATE ?= 10
LOAD_DURATION ?= 60s
BLUEGREEN_CANARY_LOCAL_PORT ?= 18081
BLUEGREEN_LOAD_DURATION ?= 270s
BLUEGREEN_LOAD_RATE ?= $(LOAD_RATE)
BLUEGREEN_LOAD_PRE_ALLOCATED_VUS ?= $(LOAD_PRE_ALLOCATED_VUS)
BLUEGREEN_LOAD_MAX_VUS ?= $(LOAD_MAX_VUS)
ROLLBACK_LOAD_DURATION ?= 90s
LOAD_PRE_ALLOCATED_VUS ?= 20
LOAD_MAX_VUS ?= 50
ROLLBACK_RECOVERY_SLEEP_SECONDS ?= 45
K6_REPORTS_DIR ?= reports
EXPECTED_VERSION ?= v1
VALIDATE_ATTEMPTS ?= 1
VALIDATE_SLEEP_SECONDS ?= 1

include dev.mk
include infra.mk

.PHONY: help doctor setup demo bluegreen preview canary rollback status clean

# --- Demo Targets ---
help:
	@printf '%s\n' 'Demo:'
	@printf '%s\n' '  make doctor      Check required local tools and Docker daemon access'
	@printf '%s\n' '  make setup       Build images, create kind if needed, install infra, deploy core app'
	@printf '%s\n' '  make demo        Run setup plus Flagger Blue/Green and Canary rollouts'
	@printf '%s\n' '  make bluegreen   Run Flagger Blue/Green with k6 candidate validation'
	@printf '%s\n' '  make canary      Run a healthy Flagger canary rollout with k6 traffic'
	@printf '%s\n' '  make status      Show Kubernetes demo state'
	@printf '%s\n' '  make clean       Delete the local kind cluster'
	@printf '%s\n' ''
	@printf '%s\n' 'Optional evidence:'
	@printf '%s\n' '  make preview     Validate an Istio header-routed v2 preview with k6'
	@printf '%s\n' '  make rollback    Break a v2 candidate and verify Flagger rollback to v1'
	@printf '%s\n' ''
	@printf '%s\n' 'Advanced checks:'
	@printf '%s\n' '  make verify           Run lint, typecheck, tests, e2e, and build'
	@printf '%s\n' '  make docker-build     Build all local Docker images'

doctor:
	@set -euo pipefail; \
	missing=0; \
	for tool in docker kind kubectl helm k6; do \
		if ! command -v "$$tool" >/dev/null 2>&1; then \
			printf 'missing required tool: %s\n' "$$tool"; \
			missing=1; \
		fi; \
	done; \
	if [ "$$missing" -ne 0 ]; then exit 1; fi; \
	if ! $(DOCKER) info >/dev/null 2>&1; then \
		printf '%s\n' 'Docker daemon is not reachable. Start Docker and retry.'; \
		exit 1; \
	fi; \
	printf '%s\n' 'Doctor passed: required tools are installed and Docker is running.'

setup: doctor
	@printf '%b\n' '$(LOG_STEP) Building local images'
	@$(MAKE) docker-build
	@printf '%b\n' '$(LOG_STEP) Creating kind cluster if needed'
	@$(MAKE) kind-create-if-needed
	@printf '%b\n' '$(LOG_STEP) Loading images into kind'
	@$(MAKE) kind-load-images
	@printf '%b\n' '$(LOG_STEP) Installing Prometheus, Istio, and Flagger'
	@$(MAKE) k8s-install-prometheus
	@$(MAKE) k8s-install-istio
	@$(MAKE) k8s-install-flagger
	@printf '%b\n' '$(LOG_STEP) Deploying core application'
	@$(MAKE) k8s-apply-core
	@printf '%b\n' '$(LOG_OK) Demo setup complete.'

demo:
	@$(MAKE) setup
	@$(MAKE) bluegreen
	@$(MAKE) canary
	@printf '%b\n' '$(LOG_OK) Core progressive delivery demo passed.'

bluegreen:
	@printf '%b\n' '$(LOG_STEP) Deploying Flagger Blue/Green resources'
	@$(MAKE) bluegreen-deploy
	@printf '%b\n' '$(LOG_STEP) Triggering Green v2 candidate'
	@$(MAKE) bluegreen-trigger
	@set -euo pipefail; \
	printf '%b\n' '$(LOG_STEP) Watching Flagger Blue/Green status'; \
	kubectl -n belo get canary/transaction-api -w & \
	watch_pid=$$!; \
	trap 'kill $$watch_pid >/dev/null 2>&1 || true; wait $$watch_pid 2>/dev/null || true' EXIT; \
	$(MAKE) bluegreen-validate-with-watch
	@printf '%b\n' '$(LOG_OK) Blue/Green demo passed: Flagger promoted Green v2.'

bluegreen-validate-with-watch:
	@printf '%b\n' '$(LOG_STEP) Validating normal traffic is still Blue v1 before promotion'
	@$(MAKE) validate-v1 VALIDATE_ATTEMPTS=10 VALIDATE_SLEEP_SECONDS=1
	@printf '%b\n' '$(LOG_STEP) Waiting for Green candidate service'
	@$(MAKE) bluegreen-wait-candidate
	@printf '%b\n' '$(LOG_STEP) Sending synthetic k6 traffic to Green candidate'
	@$(MAKE) bluegreen-candidate-load
	@printf '%b\n' '$(LOG_STEP) Waiting for Flagger Blue/Green promotion'
	@WATCH_CANARY_STATUS=0 $(MAKE) bluegreen-wait-success
	@printf '%b\n' '$(LOG_STEP) Validating promoted Green v2 through Istio Gateway'
	@$(MAKE) bluegreen-validate

preview: preview-deploy preview-wait preview-validate
	@printf '%b\n' '$(LOG_OK) Preview evidence passed: header-routed Istio traffic reached v2 while normal traffic stayed on v1.'

canary:
	@printf '%b\n' '$(LOG_STEP) Preparing Flagger canary routing'
	@$(MAKE) canary-start
	@printf '%b\n' '$(LOG_STEP) Triggered healthy v2 canary rollout'
	@set -euo pipefail; \
	printf '%b\n' '$(LOG_STEP) Watching Flagger canary status'; \
	kubectl -n belo get canary/transaction-api -w & \
	watch_pid=$$!; \
	trap 'kill $$watch_pid >/dev/null 2>&1 || true; wait $$watch_pid 2>/dev/null || true' EXIT; \
	$(MAKE) canary-promote-with-watch
	@printf '%b\n' '$(LOG_OK) Canary demo passed: Flagger promoted v2.'

canary-promote-with-watch:
	@printf '%b\n' '$(LOG_STEP) Sending k6 traffic while Flagger analyzes the canary'
	@$(MAKE) canary-load
	@WATCH_CANARY_STATUS=0 $(MAKE) canary-wait-success
	@$(MAKE) validate-v2

rollback:
	@printf '%b\n' '$(LOG_STEP) Resetting canary baseline to healthy v1'
	@$(MAKE) rollback-reset
	@printf '%b\n' '$(LOG_STEP) Breaking v2 candidate'
	@printf '%b\n' '$(LOG_WARN) Injecting rollback signal: v2 candidate returns HTTP 500 with ERROR_RATE=10 and ERROR_CODE=500'
	@$(MAKE) rollback-break-v2
	@set -euo pipefail; \
	printf '%b\n' '$(LOG_STEP) Watching Flagger rollback status'; \
	kubectl -n belo get canary/transaction-api -w & \
	watch_pid=$$!; \
	trap 'kill $$watch_pid >/dev/null 2>&1 || true; wait $$watch_pid 2>/dev/null || true' EXIT; \
	$(MAKE) rollback-fail-with-watch
	@printf '%b\n' '$(LOG_OK) Rollback demo passed: Flagger aborted v2 and traffic is back on v1.'

rollback-fail-with-watch:
	@printf '%b\n' '$(LOG_STEP) Sending rollback traffic while Flagger detects failure'
	@$(MAKE) rollback-load
	@WATCH_CANARY_STATUS=0 $(MAKE) rollback-wait-failed

status:
	@kubectl -n belo get deploy,svc,pods,canary,virtualservice,gateway 2>/dev/null || true

clean: kind-delete-if-needed
	@printf '%b\n' '$(LOG_OK) Demo cluster deleted.'
