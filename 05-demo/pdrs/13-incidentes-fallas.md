# Consolidado V3 sobre V2 - 13-incidentes-fallas

> Estado: V3 aplicado como base actual. El detalle de V2 queda preservado debajo para evitar perdida de contenido durante la mezcla.

## Base V3 actual

## 22. Mocks definidos para V3

### 22.1 Mock obligatorio: payments-core

`payments-core` no se despliega como microservicio real.

Se simula con:

```text
curl
script de generación de pagos
endpoint POST /internal/payments/approved de order-management
```

Motivo:

```text
pagos reales/compliance están fuera de scope
permite controlar duplicados y carga
reduce servicios
```

### 22.2 Mock obligatorio: tráfico Black Friday

La carga se simula con un script docente o comando controlado.

Debe poder generar:

```text
pocos pagos para happy path
burst moderado
algunos duplicados
algunos SKUs con stock bajo
```

No debe generar carga costosa ni realista a escala.

### 22.3 Mock de Promesa Express

No se crea un servicio externo real.

Se simula dentro de fulfillment con:

```text
latencia artificial
error rate artificial
fallback a promesa estándar
```

Motivo:

```text
enseña graceful degradation sin crear otro microservicio
```

### 22.4 Mock de reclamos de soporte

El docente puede mostrar mensajes narrativos:

```text
00:03 — “Pagué y no veo mi compra.”
00:07 — “El seller no puede imprimir etiqueta.”
00:11 — “Me aparece confirmado pero no cambia el tracking.”
```

Esto ayuda a volver al usuario cuando el aula se pierda en CPU/logs.

### 22.5 Mock de costos

El costo se discute conceptualmente. No se busca producir un spike de costo real.

---

## 23. Fallas controladas V3

V3 selecciona 3 fallas principales y 2 fallas secundarias.

### 23.1 Falla principal 1 — Promesa Express degrada fulfillment

**Tipo:** runtime/config
**Servicio:** fulfillment-planning
**Pilar Well-Architected relacionado:** Reliability, Operational Excellence, Performance Efficiency

#### Síntoma

```text
backlog aumenta
fulfillment tarda
tracking queda viejo
SLO critical_order_journey_under_60s_ratio se degrada
```

#### Config mala

```text
PROMESA_EXPRESS_ENABLED=true
PROMESA_EXPRESS_LATENCY_MS=1500
PROMESA_EXPRESS_ERROR_RATE=0.20
WORKER_CONCURRENCY=1
```

#### Cura

```text
PROMESA_EXPRESS_ENABLED=false
fallback a promesa estándar
opcional: WORKER_CONCURRENCY=2 o 3
```

#### Pregunta al aula

> ¿Apagamos una feature que puede mejorar conversión para salvar el flujo crítico?

---

### 23.2 Falla principal 2 — IAM bloquea shipment documents

**Tipo:** infraestructura/IAM
**Servicio:** shipment-preparation
**Pilar relacionado:** Security, Reliability, Operational Excellence

#### Síntoma

```text
fulfillment se compromete
shipment intenta generarse
fallan documentos
seller no puede despachar
tracking muestra DISPATCH_BLOCKED o queda incompleto
```

#### Config mala

```text
shipment role sin s3:PutObject
```

#### Cura

```text
agregar permiso mínimo sobre bucket/key prefix
reintentar generación de documento
```

#### Pregunta al aula

> ¿Aceptarías un permiso más amplio durante 30 minutos para recuperar despacho? ¿Con qué condiciones?

---

### 23.3 Falla principal 3 — Tracking stale / user-facing truth

**Tipo:** runtime/config / producto
**Servicio:** buyer-order-tracking
**Pilar relacionado:** Reliability, Operational Excellence

#### Síntoma

```text
internamente la orden avanzó
el comprador sigue viendo estado viejo
soporte recibe reclamos
```

#### Config mala

```text
TRACKING_CONSUMER_DELAY_MS alto
prioridad baja para eventos de tracking
```

#### Cura

```text
reducir delay
priorizar eventos buyer-facing
mostrar estado honesto aunque sea degradado
```

#### Pregunta al aula

> ¿Un sistema que procesa bien pero informa mal está sano?

---

### 23.4 Falla secundaria — payment duplicado

**Tipo:** consistencia / idempotencia
**Servicio:** order-management

#### Síntoma

```text
mismo payment_id llega dos veces por retries/bots/carga
```

#### Cura

```text
idempotencia por payment_id
unique constraint
DUPLICATE_PAYMENT_IGNORED
```

#### Uso en clase

Mini ejercicio rápido o evidencia dentro de otro stage.

---

### 23.5 Falla secundaria — CPU alta distractora

**Tipo:** observabilidad / diagnóstico
**Servicio:** container auxiliar o EC2

#### Síntoma

```text
CPU alta visible en dashboard
pero no necesariamente afecta el SLO principal
```

#### Cura

No necesariamente se cura. Se usa para discutir:

```text
métrica técnica vs dolor del usuario
síntoma vs causa
ruido vs señal
```

---


---

## Detalle V2 conservado

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

