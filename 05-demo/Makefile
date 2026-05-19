SHELL := /bin/bash
.DEFAULT_GOAL := help

PNPM_VERSION ?= 10.30.0
PNPM ?= corepack pnpm@$(PNPM_VERSION)
DOCKER ?= docker
COMPOSE ?= docker compose
CURL ?= curl

NO_COLOR ?=
ifeq ($(NO_COLOR),)
LOG_OK := \033[1;32mOK\033[0m
else
LOG_OK := OK
endif

ORDER_MANAGEMENT_DIR := services/order-management
FULFILLMENT_PLANNING_DIR := services/fulfillment-planning
SHIPMENT_PREPARATION_DIR := services/shipment-preparation
BUYER_ORDER_TRACKING_DIR := services/buyer-order-tracking
TS_SERVICE_DIRS := $(ORDER_MANAGEMENT_DIR) $(FULFILLMENT_PLANNING_DIR) $(SHIPMENT_PREPARATION_DIR) $(BUYER_ORDER_TRACKING_DIR)

MINISTACK_ENDPOINT ?= http://localhost:4566
PAYMENTS_APPROVED_QUEUE_URL ?= http://localhost:4566/000000000000/payments-approved-intake
PAYMENTS_APPROVED_DLQ_URL ?= http://localhost:4566/000000000000/payments-approved-dlq
ORDERS_CONFIRMED_QUEUE_URL ?= http://localhost:4566/000000000000/orders-confirmed-intake
ORDERS_CONFIRMED_DLQ_URL ?= http://localhost:4566/000000000000/orders-confirmed-dlq
FULFILLMENT_COMMITMENT_QUEUE_URL ?= http://localhost:4566/000000000000/fulfillment-commitment-intake
FULFILLMENT_COMMITMENT_DLQ_URL ?= http://localhost:4566/000000000000/fulfillment-commitment-dlq
FULFILLMENT_FAILED_ORDER_QUEUE_URL ?= http://localhost:4566/000000000000/fulfillment-failed-order-intake
FULFILLMENT_FAILED_ORDER_DLQ_URL ?= http://localhost:4566/000000000000/fulfillment-failed-order-dlq
BUYER_TRACKING_QUEUE_URL ?= http://localhost:4566/000000000000/buyer-tracking-events
BUYER_TRACKING_DLQ_URL ?= http://localhost:4566/000000000000/buyer-tracking-events-dlq
CUSTOMER_EXPERIENCE_QUEUE_URL ?= http://localhost:4566/000000000000/customer-experience-events
CUSTOMER_EXPERIENCE_DLQ_URL ?= http://localhost:4566/000000000000/customer-experience-events-dlq
TRACKING_TABLE_NAME ?= buyer-visible-order-state
ORDER_DATABASE_URL ?= postgresql://order:order@localhost:15432/order_management
FULFILLMENT_DATABASE_URL ?= postgresql://fulfillment:fulfillment@localhost:15433/fulfillment_planning
SHIPMENT_DATABASE_URL ?= postgresql://shipment:shipment@localhost:15434/shipment_preparation
SHIPMENT_DOCUMENTS_BUCKET ?= seller-dispatch-documents-lab
ORDER_MANAGEMENT_URL ?= http://localhost:3010
BUYER_ORDER_TRACKING_URL ?= http://localhost:3040
PROMETHEUS_URL ?= http://localhost:19090
SAGA_WORKER_CONCURRENCY ?= 4

include dev.mk

.PHONY: help doctor setup demo status clean

help:
	@printf '%s\n' 'CompraFiubi Order-to-Ship GameDay:'
	@printf '%s\n' '  make doctor                         Check local Docker/Corepack/curl prerequisites'
	@printf '%s\n' '  make setup                          Build images and start local dependencies'
	@printf '%s\n' '  make demo                           Run the full local order-to-ship saga e2e'
	@printf '%s\n' '  make verify                         Run lint, typecheck, unit tests, e2e, and build'
	@printf '%s\n' '  make test-full-saga-e2e             Run the end-to-end buyer-visible saga'
	@printf '%s\n' '  make test-full-saga-concurrency     Run the saga with higher worker concurrency'
	@printf '%s\n' '  make compose-app-up                 Start the four application services'
	@printf '%s\n' '  make compose-down                   Stop local containers and volumes'
	@printf '%s\n' '  make sqs-backlog                    Print local SQS backlog and DLQ depth'

doctor:
	@set -euo pipefail; \
	missing=0; \
	for tool in docker corepack curl; do \
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
	printf '%s\n' 'Doctor passed: local GameDay prerequisites are ready.'

setup: doctor docker-build compose-up
	@printf '%b\n' '$(LOG_OK) Local GameDay dependencies are ready.'

demo: test-full-saga-e2e
	@printf '%b\n' '$(LOG_OK) Local order-to-ship saga passed.'

status:
	@$(COMPOSE) ps

clean: compose-down
	@printf '%b\n' '$(LOG_OK) Local GameDay containers removed.'
