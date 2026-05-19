## 21. Microservicio 4 — buyer-order-tracking

### Responsabilidad

Mantener una vista visible para el comprador, con freshness razonable y timeline comprensible.

### Consume

```text
orders.order_confirmed.v1
fulfillment.commitment_confirmed.v1
fulfillment.commitment_failed.v1
shipping.shipment_ready_to_dispatch.v1
shipping.dispatch_blocked.v1
```

### Produce

```text
customer_experience.order_tracking_updated.v1
```

### Persistencia

```text
DynamoDB
```

### API mínima

```http
POST /internal/events
GET  /orders/{order_id}/tracking
GET  /buyers/{buyer_id}/orders
GET  /health
GET  /metrics
```

### Falla inicial posible

```text
TRACKING_CONSUMER_DELAY_MS alto
TRACKING_CONSUMER_ENABLED=true pero lento
```

La saga puede avanzar, pero el comprador ve estado viejo.

### Cura

```text
reducir delay
priorizar eventos buyer-facing
mostrar estados honestos: FULFILLMENT_AT_RISK, DISPATCH_BLOCKED, etc.
```

### Evidencia

```text
buyer_tracking_freshness_seconds mejora
tracking final visible
timeline reconstruible por correlation_id
```

---

