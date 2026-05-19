## 19. Microservicio 2 — fulfillment-planning

### Responsabilidad

Reservar stock, decidir si se puede cumplir la orden y generar commitment de fulfillment.

### Consume

```text
orders.order_confirmed.v1
```

### Produce

```text
fulfillment.commitment_confirmed.v1
fulfillment.commitment_failed.v1
fulfillment.commitment_at_risk.v1
```

### Persistencia

```text
RDS PostgreSQL
```

### API mínima

```http
POST /internal/events
GET  /fulfillment/orders/{order_id}
GET  /inventory/{seller_sku}
GET  /health
GET  /metrics
```

### Falla inicial principal

```text
PROMESA_EXPRESS_ENABLED=true
PROMESA_EXPRESS_LATENCY_MS alto
PROMESA_EXPRESS_ERROR_RATE > 0
WORKER_CONCURRENCY=1
```

La feature comercial agrega latencia y errores en el camino de fulfillment.

### Cura

```text
PROMESA_EXPRESS_ENABLED=false
fallback a promesa estándar
WORKER_CONCURRENCY ajustada si corresponde
```

### Evidencia

```text
backlog baja
fulfillment_commitment_latency mejora
tracking se actualiza más rápido
SLO del journey mejora
```

---

