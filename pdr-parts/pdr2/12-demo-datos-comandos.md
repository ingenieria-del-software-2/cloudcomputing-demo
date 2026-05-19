# 23. Comandos de demo

## Simular pago aprobado

```bash
curl -X POST http://ORDER_MANAGEMENT_HOST/internal/payments/approved \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

## Consultar tracking

```bash
curl http://BUYER_TRACKING_HOST/orders/ord_2000007712345678/tracking
```

Respuesta esperada:

```json
{
  "order_id": "ord_2000007712345678",
  "buyer_id": "buyer_918273",
  "visible_status": "READY_TO_DISPATCH",
  "estimated_delivery_date": "2026-05-14",
  "timeline": [
    {
      "status": "ORDER_CONFIRMED",
      "message": "Tu compra fue confirmada.",
      "occurred_at": "2026-05-12T18:42:11Z"
    },
    {
      "status": "FULFILLMENT_COMMITTED",
      "message": "Estamos preparando tu compra.",
      "occurred_at": "2026-05-12T18:43:03Z"
    },
    {
      "status": "READY_TO_DISPATCH",
      "message": "Tu compra está lista para despacho.",
      "occurred_at": "2026-05-12T18:45:22Z"
    }
  ]
}
```

---

