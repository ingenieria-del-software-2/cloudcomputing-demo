# 13. Contrato común de eventos

Todos los eventos deben tener un envelope común.

En v2, el contrato no es solo integración técnica. Es evidencia para la war room: cada compra debe poder reconstruirse con `correlation_id`, `causation_id`, timestamps y resultado de negocio.

```json
{
  "event_id": "evt_01HX9M7G8ZP2A4F7M1",
  "event_name": "orders.order_confirmed.v1",
  "event_version": "1.0",
  "occurred_at": "2026-05-12T18:42:11Z",
  "producer": "order-management",
  "correlation_id": "checkout_01HX9M6R3W",
  "causation_id": "evt_previous",
  "idempotency_key": "payment_id:pay_8800192331",
  "payload": {}
}
```

## Campos obligatorios

| Campo             | Uso                          |
| ----------------- | ---------------------------- |
| `event_id`        | Identidad única del evento   |
| `event_name`      | Tipo de evento de negocio    |
| `event_version`   | Evolución del contrato       |
| `occurred_at`     | Medición de latencias/SLOs   |
| `producer`        | Servicio emisor              |
| `correlation_id`  | Trazabilidad end-to-end      |
| `causation_id`    | Evento que causó este evento |
| `idempotency_key` | Protección ante duplicados   |
| `payload`         | Datos de negocio             |

---

# 14. Eventos principales

## 14.1 `payments.payment_approved.v1`

Emitido por:

```text
payments-core
```

Consumido por:

```text
order-management
```

Payload:

```json
{
  "payment_id": "pay_8800192331",
  "cart_id": "cart_01HX9M6R3W",
  "buyer_id": "buyer_918273",
  "seller_id": "seller_445566",
  "site_id": "MLA",
  "currency": "ARS",
  "gross_amount": 52999.99,
  "items": [
    {
      "item_id": "MLA123456789",
      "seller_sku": "NIKE-AIR-BLK-42",
      "quantity": 1,
      "unit_price": 52999.99
    }
  ]
}
```

---

## 14.2 `orders.order_confirmed.v1`

Emitido por:

```text
order-management
```

Consumido por:

```text
fulfillment-planning
buyer-order-tracking
```

Payload:

```json
{
  "order_id": "ord_2000007712345678",
  "payment_id": "pay_8800192331",
  "buyer_id": "buyer_918273",
  "seller_id": "seller_445566",
  "site_id": "MLA",
  "currency": "ARS",
  "gross_amount": 52999.99,
  "items": [
    {
      "item_id": "MLA123456789",
      "seller_sku": "NIKE-AIR-BLK-42",
      "quantity": 1,
      "unit_price": 52999.99
    }
  ],
  "confirmed_at": "2026-05-12T18:42:11Z"
}
```

---

## 14.3 `fulfillment.commitment_confirmed.v1`

Emitido por:

```text
fulfillment-planning
```

Consumido por:

```text
shipment-preparation
buyer-order-tracking
```

Payload:

```json
{
  "order_id": "ord_2000007712345678",
  "fulfillment_commitment_id": "fc_123",
  "seller_id": "seller_445566",
  "fulfillment_model": "seller_flex",
  "origin_type": "seller_location",
  "estimated_delivery_date": "2026-05-14",
  "reserved_items": [
    {
      "seller_sku": "NIKE-AIR-BLK-42",
      "quantity": 1,
      "reservation_id": "res_789"
    }
  ],
  "committed_at": "2026-05-12T18:43:03Z"
}
```

---

## 14.4 `fulfillment.commitment_failed.v1`

Emitido por:

```text
fulfillment-planning
```

Consumido por:

```text
order-management
buyer-order-tracking
```

Payload:

```json
{
  "order_id": "ord_2000007712345678",
  "reason": "STOCK_UNAVAILABLE",
  "failed_items": [
    {
      "seller_sku": "NIKE-AIR-BLK-42",
      "requested_quantity": 1,
      "available_quantity": 0
    }
  ],
  "failed_at": "2026-05-12T18:43:03Z"
}
```

---

## 14.5 `shipping.shipment_ready_to_dispatch.v1`

Emitido por:

```text
shipment-preparation
```

Consumido por:

```text
buyer-order-tracking
```

Payload:

```json
{
  "order_id": "ord_2000007712345678",
  "shipment_id": "shp_123",
  "seller_id": "seller_445566",
  "label_status": "AVAILABLE",
  "documents": [
    {
      "type": "SHIPPING_LABEL",
      "bucket": "team-03-seller-dispatch-documents-lab",
      "key": "shipments/shp_123/labels/shipping-label.pdf"
    }
  ],
  "seller_cutoff_at": "2026-05-12T18:00:00-03:00",
  "ready_to_dispatch_at": "2026-05-12T17:22:00-03:00"
}
```

---

# 15. SQS y entrega de eventos

Usamos SQS Standard para simplificar laboratorio y mostrar un punto importante: el consumidor debe ser idempotente.

AWS documenta que SQS Standard garantiza entrega al menos una vez, pero un mensaje puede entregarse más de una vez, por lo que la aplicación debe manejar duplicados con operaciones idempotentes. ([AWS Documentation][10])

## Colas propuestas

```text
payments-approved-intake
orders-confirmed-intake
fulfillment-commitment-intake
buyer-tracking-events
```

## Diseño por servicio

| Servicio               | Cola que consume                | Eventos                                  |
| ---------------------- | ------------------------------- | ---------------------------------------- |
| `order-management`     | `payments-approved-intake`      | `payments.payment_approved.v1`           |
| `fulfillment-planning` | `orders-confirmed-intake`       | `orders.order_confirmed.v1`              |
| `shipment-preparation` | `fulfillment-commitment-intake` | `fulfillment.commitment_confirmed.v1`    |
| `buyer-order-tracking` | `buyer-tracking-events`         | eventos de order, fulfillment y shipping |

## DLQs

Cada cola debe tener una DLQ:

```text
payments-approved-dlq
orders-confirmed-dlq
fulfillment-commitment-dlq
buyer-tracking-events-dlq
```

## Regla

```text
maxReceiveCount = 3 o 5 para laboratorio
```

---

# 16. Saga coreografiada

## Happy path sospechoso

El happy path se ejecuta para demostrar que las piezas mínimas están vivas, no para declarar que el sistema está sano.

```text
1. payments-core publica payments.payment_approved.v1
2. order-management confirma orden
3. order-management publica orders.order_confirmed.v1
4. fulfillment-planning reserva stock y compromete fulfillment
5. fulfillment-planning publica fulfillment.commitment_confirmed.v1
6. shipment-preparation crea shipment y documentos
7. shipment-preparation publica shipping.shipment_ready_to_dispatch.v1
8. buyer-order-tracking actualiza estado visible
```

Pregunta para el aula:

> ¿Un caso exitoso prueba confiabilidad durante Black Friday?

## Compensaciones

| Falla                   | Evento                             | Compensación                              |
| ----------------------- | ---------------------------------- | ----------------------------------------- |
| Stock insuficiente      | `fulfillment.commitment_failed.v1` | `orders.order_cancellation_requested.v1`  |
| Payment reversed        | `payments.payment_reversed.v1`     | liberar stock / cancelar shipment         |
| Shipment bloqueado      | `shipping.dispatch_blocked.v1`     | revisar promesa / marcar at-risk          |
| Documento no disponible | `shipping.dispatch_blocked.v1`     | reintentar generación o bloquear despacho |
| Tracking lag            | no compensa negocio                | alerta por frescura degradada             |

## Por qué no orquestador

No existe:

```text
order-to-ship-orchestrator
```

Ningún servicio conoce todo el flujo completo. Cada servicio conoce:

```text
qué evento consume
qué transacción local ejecuta
qué evento publica
qué compensaciones debe escuchar
```

---

