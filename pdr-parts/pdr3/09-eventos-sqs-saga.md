## 16. Contrato común de eventos

Todos los eventos usan un envelope común:

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

Campos obligatorios:

| Campo             | Uso                            |
| ----------------- | ------------------------------ |
| `event_id`        | Identidad única del evento     |
| `event_name`      | Tipo de evento de negocio      |
| `event_version`   | Evolución de contrato          |
| `occurred_at`     | Medición de latencia/freshness |
| `producer`        | Servicio emisor                |
| `correlation_id`  | Trazabilidad end-to-end        |
| `causation_id`    | Evento que causó este evento   |
| `idempotency_key` | Protección ante duplicados     |
| `payload`         | Datos de negocio               |

---

## 17. Eventos principales

V3 mantiene pocos eventos principales para no saturar.

```text
payments.payment_approved.v1
orders.order_confirmed.v1
orders.duplicate_payment_ignored.v1
fulfillment.commitment_confirmed.v1
fulfillment.commitment_failed.v1
shipping.shipment_ready_to_dispatch.v1
shipping.dispatch_blocked.v1
customer_experience.order_tracking_updated.v1
```

---

