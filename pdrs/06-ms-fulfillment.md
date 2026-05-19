# Consolidado V3 sobre V2 - 06-ms-fulfillment

> Estado: V3 aplicado como base actual. El detalle de V2 queda preservado debajo para evitar perdida de contenido durante la mezcla.

## Base V3 actual

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


---

## Detalle V2 conservado

# 10. Microservicio 2 — `fulfillment-planning`

## 10.1 Responsabilidad

> Decidir si la orden puede cumplirse, reservar/allocar stock y comprometer una promesa de fulfillment.

Este servicio agrupa tres responsabilidades que en una empresa grande podrían ser servicios separados:

```text
inventory reservation
fulfillment routing
delivery promise
```

Se agrupan para respetar la restricción de máximo 4 microservicios.

En la historia Black Friday, es el punto donde `Promesa Express` puede mejorar conversión o degradar el flujo crítico. La clase debe decidir si la feature se apaga, se degrada o se aísla.

## 10.2 Consume

```text
orders.order_confirmed.v1
```

## 10.3 Produce

```text
fulfillment.commitment_confirmed.v1
fulfillment.commitment_failed.v1
fulfillment.commitment_at_risk.v1
inventory.stock_reserved.v1
inventory.stock_reservation_failed.v1
```

## 10.4 Hace

```text
1. Recibe una orden confirmada.
2. Verifica disponibilidad por seller_sku.
3. Reserva stock.
4. Decide fulfillment model.
5. Calcula promesa de entrega, con `Promesa Express` como feature degradable.
6. Persiste commitment.
7. Publica fulfillment.commitment_confirmed.v1.
```

## 10.5 No hace

```text
No crea la orden.
No cobra pagos.
No genera etiquetas.
No prepara físicamente el despacho.
No actualiza directamente la vista del comprador.
```

## 10.6 Estados internos

```text
FULFILLMENT_REQUESTED
STOCK_RESERVED
STOCK_UNAVAILABLE
FULFILLMENT_COMMITTED
FULFILLMENT_AT_RISK
FULFILLMENT_FAILED
```

## 10.7 Persistencia

**RDS PostgreSQL**

Motivo:

```text
El dominio puede requerir:
- reservas
- stocks por SKU
- fulfillment attempts
- promesas
- cutoffs
- reglas por origen/destino
```

Aunque DynamoDB podría funcionar para una reserva simple por clave, el dominio de fulfillment tiende a crecer en complejidad y relaciones. Para la clase, PostgreSQL es más defendible y más fácil de consultar/debuggear.

## 10.8 Modelo de datos mínimo

```sql
inventory_items (
  seller_sku TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  available_quantity INTEGER NOT NULL,
  reserved_quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL
);

inventory_reservations (
  reservation_id UUID PRIMARY KEY,
  order_id UUID NOT NULL,
  seller_sku TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);

fulfillment_commitments (
  commitment_id UUID PRIMARY KEY,
  order_id UUID UNIQUE NOT NULL,
  fulfillment_model TEXT NOT NULL,
  origin_type TEXT NOT NULL,
  estimated_delivery_date DATE,
  status TEXT NOT NULL,
  committed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL
);
```

## 10.9 Reserva de stock

La operación crítica debe ser transaccional.

Ejemplo conceptual:

```sql
UPDATE inventory_items
SET available_quantity = available_quantity - :quantity,
    reserved_quantity = reserved_quantity + :quantity,
    updated_at = now()
WHERE seller_sku = :seller_sku
  AND available_quantity >= :quantity;
```

Si no actualiza filas:

```text
inventory.stock_reservation_failed.v1
```

## 10.10 API mínima para laboratorio

```http
GET /fulfillment/orders/{order_id}
GET /inventory/{seller_sku}
GET /health
```

El consumo principal es por SQS, no por API HTTP.

## 10.11 SLOs principales

### SLO 1

```text
confirmed_orders_without_stock_shortage_cancellation_ratio
```

Definición:

```text
% de órdenes confirmadas que no terminan canceladas por falta de stock
dentro de las siguientes 24 horas.
```

Objetivo:

```text
99.95% mensual
```

### SLO 2

```text
delivery_promise_created_within_15s_ratio
```

Definición:

```text
% de órdenes confirmadas que reciben promesa de fulfillment
en menos de 15 segundos.
```

Objetivo:

```text
99.0% en ventana móvil de 7 días
```

### SLO 3

```text
delivery_promise_stability_ratio
```

Definición:

```text
% de órdenes cuya fecha prometida no empeora
entre fulfillment commitment y ready to dispatch.
```

Objetivo:

```text
97.0% mensual
```

## 10.12 Fallas controladas

| Falla                   | Resultado esperado                  |
| ----------------------- | ----------------------------------- |
| Stock insuficiente      | `fulfillment.commitment_failed.v1`  |
| Evento duplicado        | No duplica reserva                  |
| Servicio apagado        | Backlog en cola                     |
| Regla de cutoff vencida | `fulfillment.commitment_at_risk.v1` |
| DB caída                | No se publica commitment            |
| Promesa Express lenta   | Aumenta latencia/backlog            |

---

