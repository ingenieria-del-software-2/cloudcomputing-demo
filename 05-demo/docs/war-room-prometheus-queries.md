# War Room Prometheus Queries

Use this when Grafana is intentionally out of scope. The same metrics can become dashboard panels later, but this local path uses Prometheus HTTP directly.

Start Prometheus with the service stack:

```bash
PROMESA_EXPRESS_ERROR_RATE=0 PROMESA_EXPRESS_LATENCY_MS=0 \
  docker compose --profile metrics up -d --wait --build prometheus
```

Run ad hoc queries:

```bash
curl -fsSG http://localhost:19090/api/v1/query --data-urlencode 'query=critical_order_journey_under_60s_ratio'
```

## Primary User Journey

| Question                                                   | Query                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Are test purchases reaching buyer-visible state under 60s? | `critical_order_journey_under_60s_ratio`                                                          |
| What is the p95 order-to-visible-tracking duration?        | `histogram_quantile(0.95, sum(rate(critical_order_journey_duration_seconds_bucket[2m])) by (le))` |
| Is buyer-visible state stale?                              | `buyer_tracking_freshness_p95`                                                                    |
| What is the freshness SLO ratio?                           | `buyer_tracking_freshness_under_60s_ratio`                                                        |

## Backlog And DLQs

| Question                                | Query                                                 |
| --------------------------------------- | ----------------------------------------------------- |
| Where is work accumulating?             | `event_backlog_depth`                                 |
| Did any service move messages to DLQ?   | `event_dlq_depth`                                     |
| Are SQS publishes failing?              | `sum by (service, queue, status) (sqs_publish_total)` |
| Are SQS consumers processing or idling? | `sum by (service, queue, status) (sqs_consume_total)` |

## Service Drill-Down

| Service                | Question                                                       | Query                                                                  |
| ---------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `order-management`     | Are duplicates being ignored instead of creating extra orders? | `duplicate_order_attempts_total`                                       |
| `order-management`     | Are confirmations within 5s?                                   | `order_confirmation_within_5s_ratio`                                   |
| `fulfillment-planning` | Is Promesa Express failing?                                    | `promesa_express_failures_total`                                       |
| `fulfillment-planning` | Are delivery promises within 15s?                              | `delivery_promise_created_within_15s_ratio`                            |
| `fulfillment-planning` | Are stock shortage cancellations avoided?                      | `confirmed_orders_without_stock_shortage_cancellation_ratio`           |
| `shipment-preparation` | Are document writes failing?                                   | `shipment_document_failures_total`                                     |
| `shipment-preparation` | Are documents available on first access?                       | `dispatch_document_availability_on_first_access_ratio`                 |
| `shipment-preparation` | Are S3-compatible writes failing by reason?                    | `sum by (status, reason) (s3_put_object_total)`                        |
| `buyer-order-tracking` | Is DynamoDB-compatible access healthy?                         | `sum by (operation, status) (dynamodb_request_duration_seconds_count)` |

## CLI Snippets

Critical journey ratio:

```bash
curl -fsSG http://localhost:19090/api/v1/query \
  --data-urlencode 'query=critical_order_journey_under_60s_ratio'
```

Backlog by service and queue:

```bash
curl -fsSG http://localhost:19090/api/v1/query \
  --data-urlencode 'query=event_backlog_depth'
```

Document failures:

```bash
curl -fsSG http://localhost:19090/api/v1/query \
  --data-urlencode 'query=sum by (status, reason) (s3_put_object_total)'
```

Promesa Express failures:

```bash
curl -fsSG http://localhost:19090/api/v1/query \
  --data-urlencode 'query=promesa_express_failures_total'
```

Rule for the class: if the primary journey is healthy, CPU and container metrics are supporting context, not the incident definition.
