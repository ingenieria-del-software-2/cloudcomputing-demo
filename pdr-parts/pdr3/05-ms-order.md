## 18. Microservicio 1 — order-management

### Responsabilidad

Confirmar y administrar la orden comercial a partir de un pago aprobado.

### Consume

```text
payments.payment_approved.v1
```

En V3, `payments-core` es mockeado por endpoint/script.

### Produce

```text
orders.order_confirmed.v1
orders.duplicate_payment_ignored.v1
orders.order_confirmation_failed.v1
```

### Persistencia

```text
RDS PostgreSQL
```

### API mínima

```http
POST /internal/payments/approved
GET  /orders/{order_id}
GET  /health
GET  /metrics
```

### Falla inicial posible

```text
IDEMPOTENCY_ENABLED=false
```

Con carga/retries, el mismo payment_id puede intentar crear más de una orden.

### Cura

```text
IDEMPOTENCY_ENABLED=true
unique constraint sobre payment_id
manejo explícito de duplicate payment
```

### Evidencia

```text
orden creada
payment duplicado ignorado
log con correlation_id
metric duplicate_order_attempts_total
```

---

