# Consolidado V3 sobre V2 - 08-ms-tracking

> Estado: V3 aplicado como base actual. El detalle de V2 queda preservado debajo para evitar perdida de contenido durante la mezcla.

## Base V3 actual

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


---

## Detalle V2 conservado

# 12. Microservicio 4 — `buyer-order-tracking`

## 12.1 Responsabilidad

> Mantener una vista materializada del estado visible para el comprador.

Este servicio no es el core transaccional de la saga. Es una proyección customer-facing.

En la historia Black Friday, representa la verdad percibida por el comprador. Si queda vieja o muestra un estado engañoso, soporte arde aunque los servicios internos hayan avanzado.

## 12.2 Consume

```text
orders.order_confirmed.v1
fulfillment.commitment_confirmed.v1
fulfillment.commitment_at_risk.v1
fulfillment.commitment_failed.v1
shipping.shipment_ready_to_dispatch.v1
shipping.dispatch_blocked.v1
```

## 12.3 Produce

Opcional:

```text
customer_experience.order_tracking_updated.v1
```

## 12.4 Hace

```text
1. Consume eventos del ciclo de vida.
2. Traduce estados internos a estados visibles.
3. Actualiza el estado actual de la orden para el comprador.
4. Mantiene timeline.
5. Responde GET /orders/{order_id}/tracking.
```

## 12.5 No hace

```text
No confirma órdenes.
No reserva stock.
No genera documentos.
No decide si la saga continúa.
No corrige el estado canónico de otros servicios.
```

## 12.6 Persistencia

**DynamoDB**

Motivo:

```text
Es un read model denormalizado.
Tiene access patterns claros.
Consulta por order_id o buyer_id.
No requiere joins complejos.
Debe responder rápido.
```

DynamoDB es una base NoSQL serverless y fully managed con performance de milisegundos de un dígito a escala; es razonable para una vista materializada consultada por clave, pero no se usa acá como reemplazo general de PostgreSQL. ([AWS Documentation][9])

## 12.7 Modelo DynamoDB sugerido

### Opción simple

Tabla:

```text
buyer-visible-order-state
```

Clave:

```text
PK = order_id
```

Atributos:

```json
{
  "order_id": "ord_123",
  "buyer_id": "buyer_456",
  "visible_status": "READY_TO_DISPATCH",
  "last_event_name": "shipping.shipment_ready_to_dispatch.v1",
  "estimated_delivery_date": "2026-05-14",
  "updated_at": "2026-05-12T20:30:00Z",
  "timeline": [
    {
      "status": "ORDER_CONFIRMED",
      "occurred_at": "2026-05-12T20:00:00Z"
    },
    {
      "status": "FULFILLMENT_COMMITTED",
      "occurred_at": "2026-05-12T20:02:00Z"
    },
    {
      "status": "READY_TO_DISPATCH",
      "occurred_at": "2026-05-12T20:30:00Z"
    }
  ]
}
```

### Opción con índice por comprador

```text
PK = buyer_id
SK = order_id
```

Sirve para:

```text
GET /buyers/{buyer_id}/orders
```

## 12.8 Estados visibles

```text
ORDER_CONFIRMED
FULFILLMENT_IN_PROGRESS
FULFILLMENT_COMMITTED
FULFILLMENT_AT_RISK
READY_TO_DISPATCH
DISPATCH_BLOCKED
CANCELLED
```

## 12.9 API mínima para laboratorio

```http
GET /orders/{order_id}/tracking
GET /buyers/{buyer_id}/orders
GET /health
```

## 12.10 SLO principal

```text
buyer_tracking_freshness_under_60s_ratio
```

Definición:

```text
% de cambios relevantes de estado que se reflejan
en el tracking visible para comprador en menos de 60 segundos.
```

Objetivo:

```text
99.0% en ventana móvil de 7 días
```

---

