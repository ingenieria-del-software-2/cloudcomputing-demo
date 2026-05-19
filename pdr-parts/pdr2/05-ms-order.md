# 9. Microservicio 1 — `order-management`

## 9.1 Responsabilidad

> Confirmar y administrar el ciclo comercial de una orden a partir de un pago aprobado.

Este servicio es dueño de la verdad comercial inicial de la orden.

En la historia Black Friday, protege que un pago aprobado no cree caos comercial: órdenes duplicadas, estados inconsistentes o reclamos por compras que “desaparecen”.

## 9.2 Consume

```text
payments.payment_approved.v1
```

## 9.3 Produce

```text
orders.order_confirmed.v1
orders.order_confirmation_failed.v1
orders.order_cancelled.v1
```

## 9.4 Hace

```text
1. Recibe un pago aprobado.
2. Valida idempotencia por payment_id.
3. Crea order_id.
4. Persiste orden, ítems, comprador, vendedor e importes.
5. Publica orders.order_confirmed.v1.
6. Expone estado administrativo básico de la orden.
```

## 9.5 No hace

```text
No reserva stock.
No calcula promesa logística.
No genera etiqueta.
No actualiza directamente el tracking buyer-facing.
No escribe bases de otros servicios.
```

## 9.6 Estados internos

```text
PAYMENT_APPROVED_RECEIVED
ORDER_CONFIRMED
ORDER_CONFIRMATION_FAILED
CANCELLATION_REQUESTED
ORDER_CANCELLED
```

## 9.7 Persistencia

**RDS PostgreSQL**

Motivo:

```text
La orden tiene estructura relacional:
- order
- order_items
- buyer
- seller
- payment reference
- status transitions
```

Amazon RDS for PostgreSQL soporta backups, snapshots, point-in-time restore, read replicas, Multi-AZ y despliegue dentro de VPC, lo que lo vuelve una buena base gestionada para un dominio relacional de órdenes. ([AWS Documentation][7])

## 9.8 Modelo de datos mínimo

```sql
orders (
  order_id UUID PRIMARY KEY,
  payment_id TEXT UNIQUE NOT NULL,
  buyer_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  gross_amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

order_items (
  order_item_id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(order_id),
  item_id TEXT NOT NULL,
  seller_sku TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL
);

order_status_transitions (
  transition_id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(order_id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  occurred_at TIMESTAMP NOT NULL
);
```

## 9.9 Idempotencia

Clave:

```text
payment_id
```

Regla:

```text
Un payment_id aprobado no puede crear más de una orden.
```

Implementación:

```sql
UNIQUE(payment_id)
```

Si llega dos veces `payments.payment_approved.v1`, el servicio debe devolver/publicar:

```text
DUPLICATE_PAYMENT_IGNORED
```

No debe crear una segunda orden.

## 9.10 API mínima para laboratorio

```http
POST /internal/payments/approved
GET  /orders/{order_id}
GET  /health
```

El `POST /internal/payments/approved` simula la llegada desde `payments-core`.

## 9.11 SLO principal

```text
order_confirmation_within_5s_ratio
```

### Definición

Porcentaje de pagos aprobados que generan una orden confirmada y visible en menos de 5 segundos.

### Fórmula

```text
good_events / eligible_events
```

Donde:

```text
eligible_events =
  payments.payment_approved.v1 recibidos válidos

good_events =
  eventos que terminan en ORDER_CONFIRMED
  dentro de 5 segundos
  sin duplicar la orden
```

### Objetivo

```text
99.5% en ventana móvil de 7 días
```

## 9.12 Falla controlada

### Caso

Enviar dos veces el mismo `payment_id`.

### Resultado esperado

```text
Se crea una sola orden.
El segundo evento se registra como duplicado ignorado.
No se degrada el SLO de duplicación.
```

---

