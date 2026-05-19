.PHONY: \
	build build-ts \
	lint lint-ts lint-fix \
	typecheck typecheck-ts \
	test test-ts test-order-management-e2e test-fulfillment-planning-e2e test-shipment-preparation-e2e test-buyer-order-tracking-e2e test-full-saga-e2e test-full-saga-concurrency test-prometheus \
	verify verify-order-management verify-fulfillment-planning verify-shipment-preparation verify-buyer-order-tracking \
	docker-build compose-up compose-app-up compose-deps-up compose-metrics-up compose-down compose-reset compose-logs sqs-backlog

# --- Global Targets ---
build: build-ts
lint: lint-ts
typecheck: typecheck-ts
test: test-ts
verify: lint typecheck test test-order-management-e2e test-fulfillment-planning-e2e test-shipment-preparation-e2e test-buyer-order-tracking-e2e test-full-saga-e2e build

build-ts lint-ts typecheck-ts test-ts:
	@set -euo pipefail; \
	for dir in $(TS_SERVICE_DIRS); do \
		$(PNPM) --dir "$$dir" run $(subst -ts,,$@); \
	done

lint-fix:
	@set -euo pipefail; \
	for dir in $(TS_SERVICE_DIRS); do \
		$(PNPM) --dir "$$dir" run lint:fix; \
	done

# --- TS Package Targets (Dynamic) ---
TS_TASKS := build lint typecheck test
$(addsuffix -order-management, $(TS_TASKS)):
	$(PNPM) --dir $(ORDER_MANAGEMENT_DIR) run $(subst -order-management,,$@)

$(addsuffix -fulfillment-planning, $(TS_TASKS)):
	$(PNPM) --dir $(FULFILLMENT_PLANNING_DIR) run $(subst -fulfillment-planning,,$@)

$(addsuffix -shipment-preparation, $(TS_TASKS)):
	$(PNPM) --dir $(SHIPMENT_PREPARATION_DIR) run $(subst -shipment-preparation,,$@)

$(addsuffix -buyer-order-tracking, $(TS_TASKS)):
	$(PNPM) --dir $(BUYER_ORDER_TRACKING_DIR) run $(subst -buyer-order-tracking,,$@)

verify-order-management: lint-order-management typecheck-order-management test-order-management test-order-management-e2e build-order-management
verify-fulfillment-planning: lint-fulfillment-planning typecheck-fulfillment-planning test-fulfillment-planning test-fulfillment-planning-e2e build-fulfillment-planning
verify-shipment-preparation: lint-shipment-preparation typecheck-shipment-preparation test-shipment-preparation test-shipment-preparation-e2e build-shipment-preparation
verify-buyer-order-tracking: lint-buyer-order-tracking typecheck-buyer-order-tracking test-buyer-order-tracking test-buyer-order-tracking-e2e test-full-saga-e2e build-buyer-order-tracking

# --- Test Environment Macros ---
define run_order_test
	@set -euo pipefail; \
	trap '$(COMPOSE) --profile metrics down --remove-orphans -v' EXIT; \
	$(COMPOSE) up -d --wait ministack order-postgres; \
	$(COMPOSE) run --rm payments-approved-queue; \
	$(COMPOSE) run --rm orders-confirmed-queue; \
	AWS_REGION=us-east-1 AWS_ENDPOINT_URL=$(MINISTACK_ENDPOINT) AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
	DATABASE_URL=$(ORDER_DATABASE_URL) PAYMENT_INTAKE_SQS_QUEUE_URL=$(PAYMENTS_APPROVED_QUEUE_URL) SQS_QUEUE_URL=$(ORDERS_CONFIRMED_QUEUE_URL) $(1)
endef

define run_fulfillment_test
	@set -euo pipefail; \
	trap '$(COMPOSE) --profile metrics down --remove-orphans -v' EXIT; \
	$(COMPOSE) up -d --wait ministack fulfillment-postgres; \
	$(COMPOSE) run --rm orders-confirmed-queue; \
	$(COMPOSE) run --rm fulfillment-commitment-queue; \
	AWS_REGION=us-east-1 AWS_ENDPOINT_URL=$(MINISTACK_ENDPOINT) AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
	DATABASE_URL=$(FULFILLMENT_DATABASE_URL) INPUT_SQS_QUEUE_URL=$(ORDERS_CONFIRMED_QUEUE_URL) SQS_QUEUE_URL=$(FULFILLMENT_COMMITMENT_QUEUE_URL) \
	PROMESA_EXPRESS_ENABLED=false PROMESA_EXPRESS_ERROR_RATE=0 PROMESA_EXPRESS_LATENCY_MS=0 WORKER_CONCURRENCY=1 $(1)
endef

define run_shipment_test
	@set -euo pipefail; \
	trap '$(COMPOSE) --profile metrics down --remove-orphans -v' EXIT; \
	$(COMPOSE) up -d --wait ministack shipment-postgres; \
	$(COMPOSE) run --rm fulfillment-commitment-queue; \
	$(COMPOSE) run --rm buyer-tracking-queue; \
	$(COMPOSE) run --rm shipment-documents-bucket; \
	AWS_REGION=us-east-1 AWS_ENDPOINT_URL=$(MINISTACK_ENDPOINT) AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
	DATABASE_URL=$(SHIPMENT_DATABASE_URL) INPUT_SQS_QUEUE_URL=$(FULFILLMENT_COMMITMENT_QUEUE_URL) SQS_QUEUE_URL=$(BUYER_TRACKING_QUEUE_URL) \
	SHIPMENT_DOCUMENTS_BUCKET=$(SHIPMENT_DOCUMENTS_BUCKET) S3_BAD_KEY_ENABLED=false S3_PUT_OBJECT_ALLOWED=true S3_TRANSIENT_FAILURES_BEFORE_SUCCESS=0 \
	S3_UPLOAD_MAX_ATTEMPTS=2 S3_UPLOAD_RETRY_DELAY_MS=0 SELLER_CUTOFF_EXPIRED=false WORKER_CONCURRENCY=1 $(1)
endef

define run_tracking_test
	@set -euo pipefail; \
	trap '$(COMPOSE) --profile metrics down --remove-orphans -v' EXIT; \
	$(COMPOSE) up -d ministack; \
	$(COMPOSE) run --rm buyer-tracking-queue; \
	$(COMPOSE) run --rm customer-experience-queue; \
	AWS_REGION=us-east-1 AWS_ENDPOINT_URL=$(MINISTACK_ENDPOINT) AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
	TRACKING_TABLE_NAME=$(TRACKING_TABLE_NAME) INPUT_SQS_QUEUE_URL=$(BUYER_TRACKING_QUEUE_URL) SQS_QUEUE_URL=$(CUSTOMER_EXPERIENCE_QUEUE_URL) \
	TRACKING_CONSUMER_ENABLED=true TRACKING_CONSUMER_DELAY_MS=0 WORKER_CONCURRENCY=1 $(1)
endef

test-order-management-e2e:
	$(call run_order_test, $(PNPM) --dir $(ORDER_MANAGEMENT_DIR) run test:e2e)

test-fulfillment-planning-e2e:
	$(call run_fulfillment_test, $(PNPM) --dir $(FULFILLMENT_PLANNING_DIR) run test:e2e)

test-shipment-preparation-e2e:
	$(call run_shipment_test, $(PNPM) --dir $(SHIPMENT_PREPARATION_DIR) run test:e2e)

test-buyer-order-tracking-e2e:
	$(call run_tracking_test, $(PNPM) --dir $(BUYER_ORDER_TRACKING_DIR) run test:e2e)

test-full-saga-e2e:
	@set -euo pipefail; \
	trap '$(COMPOSE) --profile metrics down --remove-orphans -v' EXIT; \
	PROMESA_EXPRESS_ERROR_RATE=0 PROMESA_EXPRESS_LATENCY_MS=0 $(COMPOSE) up -d --wait --build order-management fulfillment-planning shipment-preparation buyer-order-tracking; \
	ORDER_MANAGEMENT_URL=$(ORDER_MANAGEMENT_URL) BUYER_ORDER_TRACKING_URL=$(BUYER_ORDER_TRACKING_URL) \
	$(PNPM) --dir $(BUYER_ORDER_TRACKING_DIR) run test:full-saga

test-full-saga-concurrency:
	@set -euo pipefail; \
	trap '$(COMPOSE) --profile metrics down --remove-orphans -v' EXIT; \
	PROMESA_EXPRESS_ERROR_RATE=0 PROMESA_EXPRESS_LATENCY_MS=0 WORKER_CONCURRENCY=$(SAGA_WORKER_CONCURRENCY) TRACKING_MAX_MESSAGES_PER_POLL=10 $(COMPOSE) up -d --wait --build order-management fulfillment-planning shipment-preparation buyer-order-tracking; \
	ORDER_MANAGEMENT_URL=$(ORDER_MANAGEMENT_URL) BUYER_ORDER_TRACKING_URL=$(BUYER_ORDER_TRACKING_URL) \
	$(PNPM) --dir $(BUYER_ORDER_TRACKING_DIR) run test:full-saga; \
	$(MAKE) sqs-backlog

test-prometheus:
	@set -euo pipefail; \
	trap '$(COMPOSE) --profile metrics down --remove-orphans -v' EXIT; \
	$(COMPOSE) --profile metrics up --wait --build prometheus; \
	$(CURL) -fsS -X POST "$(ORDER_MANAGEMENT_URL)/internal/payments/approved" \
		-H 'Content-Type: application/json' \
		-H 'x-correlation-id: checkout_prometheus_smoke' \
		-H 'x-request-id: req_prometheus_smoke' \
		-d '{"payment_id":"pay_prometheus_smoke","cart_id":"cart_prometheus_smoke","buyer_id":"buyer_prometheus_smoke","seller_id":"seller_445566","site_id":"MLA","currency":"ARS","gross_amount":12999.99,"items":[{"item_id":"CFB-CARPINCHO-USB","seller_sku":"CARPINCHO-USB-C","quantity":1,"unit_price":12999.99}]}' >/dev/null; \
	found=0; \
	for _ in $$(seq 1 30); do \
		if $(CURL) -fsSG "$(PROMETHEUS_URL)/api/v1/query" --data-urlencode 'query=sqs_publish_total{service="order-management"}' | grep -q '"value"'; then \
			found=1; \
			break; \
		fi; \
		sleep 1; \
	done; \
	if [ "$$found" -eq 0 ]; then \
		echo "sqs_publish_total not found in Prometheus"; \
		exit 1; \
	fi

# --- Docker & Compose ---
docker-build-%:
	$(DOCKER) build -f build/docker/$*.Dockerfile -t $*:local .

docker-build: docker-build-order-management docker-build-fulfillment-planning docker-build-shipment-preparation docker-build-buyer-order-tracking

compose-app-up:
	$(COMPOSE) up -d --build order-management fulfillment-planning shipment-preparation buyer-order-tracking

compose-deps-up compose-up:
	$(COMPOSE) up -d ministack
	$(COMPOSE) run --rm payments-approved-queue
	$(COMPOSE) run --rm orders-confirmed-queue
	$(COMPOSE) run --rm fulfillment-commitment-queue
	$(COMPOSE) run --rm fulfillment-failed-order-queue
	$(COMPOSE) run --rm buyer-tracking-queue
	$(COMPOSE) run --rm customer-experience-queue
	$(COMPOSE) run --rm shipment-documents-bucket

compose-metrics-up:
	$(COMPOSE) --profile metrics up --wait --build prometheus

compose-down compose-reset:
	$(COMPOSE) --profile metrics down --remove-orphans -v
	@if [ "$@" = "compose-reset" ]; then $(MAKE) compose-deps-up; fi

compose-logs:
	$(COMPOSE) logs -f

sqs-backlog:
	@set -euo pipefail; \
	for queue in $(PAYMENTS_APPROVED_QUEUE_URL) $(PAYMENTS_APPROVED_DLQ_URL) $(ORDERS_CONFIRMED_QUEUE_URL) $(ORDERS_CONFIRMED_DLQ_URL) $(FULFILLMENT_COMMITMENT_QUEUE_URL) $(FULFILLMENT_COMMITMENT_DLQ_URL) $(FULFILLMENT_FAILED_ORDER_QUEUE_URL) $(FULFILLMENT_FAILED_ORDER_DLQ_URL) $(BUYER_TRACKING_QUEUE_URL) $(BUYER_TRACKING_DLQ_URL) $(CUSTOMER_EXPERIENCE_QUEUE_URL) $(CUSTOMER_EXPERIENCE_DLQ_URL); do \
		name=$${queue##*/}; \
		printf '%s\n' "==> $$name"; \
		$(CURL) -fsS -X POST "$(MINISTACK_ENDPOINT)/" \
			-H 'Content-Type: application/x-www-form-urlencoded' \
			--data 'Action=GetQueueAttributes' \
			--data 'Version=2012-11-05' \
			--data-urlencode "QueueUrl=$$queue" \
			--data 'AttributeName.1=ApproximateNumberOfMessages' \
			--data 'AttributeName.2=ApproximateNumberOfMessagesNotVisible' \
			--data 'AttributeName.3=ApproximateNumberOfMessagesDelayed' \
			--data 'AttributeName.4=RedrivePolicy'; \
		printf '\n'; \
	done
