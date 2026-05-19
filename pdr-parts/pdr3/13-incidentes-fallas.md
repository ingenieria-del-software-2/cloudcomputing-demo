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

