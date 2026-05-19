# 24. Incidentes narrativos Black Friday

Los incidentes no se presentan como tests aislados. Cada falla viene de la historia: Black Friday empezó, se activó `Promesa Express` y hubo cambios simultáneos de infraestructura.

## Incidente 1 — Promesa Express degrada fulfillment

### Historia

La nueva feature intenta calcular promesas más agresivas:

```text
“Llega mañana”
“Despacho prioritario”
“Stock listo para envío”
```

Durante el pico, esa lógica mete latencia y aumenta errores en `fulfillment-planning`.

### Síntoma visible

```text
pagos aprobados tardan en llegar a tracking
fulfillment se demora
buyer tracking queda congelado en ORDER_CONFIRMED
```

### Acción controlada

Activar el modo lento/error de `Promesa Express` o aumentar artificialmente su latencia.

### Esperado

```text
fulfillment_commitment_latency_p95 empeora
order_to_buyer_visible_tracking_under_2m_ratio se degrada
SQS orders-confirmed-intake acumula mensajes
la clase decide apagar, degradar o aislar Promesa Express
```

### Conceptos

```text
graceful degradation
feature flag
trade-off producto/confiabilidad
SLO de journey
```

Pregunta madre:

> ¿Qué mata más negocio: apagar Promesa Express o degradar checkout?

---

## Incidente 2 — Cambios de infra generan backlog

### Historia

No hubo un cambio malo. Hubo demasiados cambios no coordinados.

```text
23:20 Infra ajusta workers/concurrencia.
23:35 Seguridad cambia permisos.
23:40 Observabilidad sube logging.
23:50 Producto activa Promesa Express.
00:00 Black Friday empieza.
```

### Síntoma visible

```text
order-management sigue aceptando pagos
fulfillment se atrasa
shipment no llega a tiempo
tracking queda viejo
```

### Acción controlada

Reducir workers de `fulfillment-planning`, bajar timeouts o subir retries para que la cola crezca.

### Esperado

```text
SQS queue depth aumenta
DLQ puede crecer si los retries saturan
el sistema sigue “up” pero incumple el SLO
la clase decide escalar, limitar entrada o priorizar eventos críticos
```

### Conceptos

```text
backpressure
queueing
retries
idempotencia
rollback discipline
```

Pregunta:

> ¿Escalar arregla el incidente o solo lo hace más caro?

---

## Incidente 3 — IAM bloquea shipment/documentos

### Historia

Seguridad endureció permisos antes del evento. La intención era buena; el resultado es que `shipment-preparation` no puede guardar etiquetas o instrucciones de despacho.

### Acción controlada

Remover `s3:PutObject` del rol de `shipment-preparation` o apuntar a un bucket/key no permitido.

### Esperado

```text
shipping.dispatch_blocked.v1
AccessDenied en logs
no hay etiqueta disponible
tracking refleja DISPATCH_BLOCKED o un estado equivalente
dispatch_document_failure_count aumenta
```

### Decisión esperada

```text
rollback del permiso
fix mínimo
permiso amplio temporal con expiración
despacho manual
degradación del estado visible
```

### Conceptos

```text
IAM
least privilege
blast radius
mitigación controlada
rollback
```

Pregunta:

> ¿Durante un incidente aceptarías un permiso más amplio por 30 minutos?

---

## Incidente 4 — El comprador ve una mentira vieja

### Historia

Internamente la saga avanzó, pero el comprador sigue viendo:

```text
“Compra confirmada”
```

Soporte recibe reclamos porque el sistema interno y la experiencia visible no coinciden.

### Acción controlada

Detener `buyer-order-tracking`, pausar su consumidor o aumentar artificialmente el lag del read model.

### Esperado

```text
la saga core sigue avanzando
buyer_tracking_freshness_p95 empeora
tracking visible queda en estado viejo
la clase reconstruye la orden con correlation_id
```

### Conceptos

```text
estado interno vs estado visible
read model
freshness
user-facing reliability
```

Pregunta:

> ¿Un sistema que procesa bien pero informa mal está sano?

---

## Incidente 5 — Bots/retries duplican pagos

### Historia

Durante el pico, bots, retries de cliente o entregas al menos una vez generan eventos repetidos para el mismo `payment_id`.

### Acción controlada

Enviar dos veces el mismo payload con `payment_id`.

### Esperado

```text
se crea una sola orden
el duplicado se ignora
log con DUPLICATE_PAYMENT_IGNORED
duplicate_payment_ignored_count aumenta
no se duplica stock ni shipment
```

### Conceptos

```text
idempotencia
SQS at-least-once
unique constraint
evento duplicado ≠ compra duplicada
```

## Mapeo desde incidentes técnicos originales

| Incidente técnico original | Nueva versión narrativa Black Friday                 | Cura SRE                                                    |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| Pago duplicado             | Bots/retries duplican eventos de pago durante pico   | Idempotencia, deduplicación, invariantes                    |
| Stock insuficiente         | Promo agresiva vende más unidades de las disponibles | Reserva transaccional, compensación, estado visible honesto |
| Apagar fulfillment         | Workers saturados o mal configurados generan backlog | Backpressure, escalado selectivo, degradación               |
| Quitar permiso S3          | Cambio IAM bloquea etiquetas de despacho             | Rollback/fix de permisos, blast radius                      |
| Tracking lag               | Read model atrasado mientras soporte recibe reclamos | Freshness SLI, correlation_id, priorización                 |
| Logs ruidosos              | Observabilidad produce ruido y costo                 | Alertas por síntomas, reducción de ruido                    |
| Evento duplicado           | SQS entrega al menos una vez / retries               | Consumidores idempotentes                                   |
| DB lenta                   | Cambio de concurrencia satura RDS                    | Límites, tuning, no escalar ciegamente                      |

---

