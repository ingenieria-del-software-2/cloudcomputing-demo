# 17. SLOs/SLIs del sistema

Los SLOs dejan de ser una sección de referencia al final de la arquitectura y pasan a ser el volante de la clase.

La war room necesita acordar qué significa “estar bien” antes de perseguir CPU, logs ruidosos o métricas aisladas.

## SLO principal de emergencia

```text
order_to_buyer_visible_tracking_under_2m_ratio
```

Definición:

```text
% de pagos aprobados que llegan a un estado visible de tracking
en menos de 2 minutos,
sin duplicar orden
y sin vender stock inexistente.
```

Objetivo didáctico:

```text
95% durante la ventana crítica del taller
```

Este SLO no pretende ser el SLO real de una empresa. Es una herramienta pedagógica para obligar a pensar end-to-end.

## SLIs secundarios de drill-down

| SLI                                  | Qué enseña                               |
| ------------------------------------ | ---------------------------------------- |
| `order_confirmation_latency_p95`     | La entrada no alcanza si core tarda      |
| `fulfillment_commitment_latency_p95` | Backlog y promesa logística              |
| `ready_to_dispatch_ratio`            | El negocio no termina en “orden creada”  |
| `buyer_tracking_freshness_p95`       | Experiencia visible                      |
| `duplicate_payment_ignored_count`    | Idempotencia bajo retries                |
| `dlq_message_count`                  | Fallas persistentes                      |
| `dispatch_document_failure_count`    | Permisos/documentos/shipment             |

## SLOs por servicio como material de soporte

Los SLOs específicos de cada microservicio siguen documentados en sus secciones, pero no se usan como tablero principal del taller. Sirven para diagnosticar una vez que el SLO de journey indica dolor real.

| Servicio               | SLO/SLI de soporte                            |
| ---------------------- | --------------------------------------------- |
| `order-management`     | `order_confirmation_within_5s_ratio`          |
| `fulfillment-planning` | `delivery_promise_created_within_15s_ratio`   |
| `shipment-preparation` | `ready_to_dispatch_before_seller_cutoff_ratio` |
| `buyer-order-tracking` | `buyer_tracking_freshness_under_60s_ratio`    |

## Métricas técnicas como drill-down

No se ponen en el tablero principal. Se usan cuando el SLO de usuario dice que hay dolor.

| Métrica técnica             | Para qué sirve                    |
| --------------------------- | --------------------------------- |
| SQS queue depth             | Detectar backlog                  |
| DLQ messages                | Diagnosticar errores persistentes |
| EC2 status check            | Ver salud de instancia            |
| RDS connections             | Detectar saturación               |
| RDS query latency           | Diagnóstico de DB                 |
| S3 4xx/5xx                  | Diagnóstico de documentos         |
| DynamoDB read/write latency | Diagnóstico de tracking           |
| IAM AccessDenied count      | Diagnóstico de permisos           |

Regla de operación:

> CPU alta no es automáticamente un incidente. Compradores con pagos aprobados sin tracking defendible sí lo son.

---

# 18. Observabilidad

La observabilidad se trata como evidencia para la war room. El objetivo no es generar más logs, sino reconstruir qué pasó, cuándo pasó, qué cambió, qué usuario fue afectado y si la mitigación funcionó.

## Logs obligatorios

Cada servicio debe loggear:

```text
service_name
event_id
event_name
correlation_id
order_id
payment_id si aplica
shipment_id si aplica
status_before
status_after
business_error_code
duration_ms
```

## Ejemplo de log

```json
{
  "service": "fulfillment-planning",
  "correlation_id": "checkout_01HX9M6R3W",
  "event_id": "evt_123",
  "event_name": "orders.order_confirmed.v1",
  "order_id": "ord_2000007712345678",
  "result": "FULFILLMENT_COMMITTED",
  "duration_ms": 842,
  "slo": "delivery_promise_created_within_15s_ratio"
}
```

## Dashboard sugerido para war room

```text
Black Friday War Room
- order_to_buyer_visible_tracking_under_2m_ratio
- pagos aprobados sin tracking visible
- p95 end-to-end payment approved → tracking visible
- órdenes at-risk por fulfillment/shipment
- buyer tracking freshness p95
- backlog por cola
- DLQ messages
- AccessDenied / document failures

Drill-down por servicio

Order Management
- pagos aprobados recibidos
- órdenes confirmadas
- duplicados ignorados
- p95 confirmation latency
- SLO confirmation < 5s

Fulfillment Planning
- órdenes recibidas
- stock reservado
- commitments confirmados
- commitments fallidos
- p95 commitment latency
- SLO delivery promise < 15s

Shipment Preparation
- shipments creados
- etiquetas generadas
- documentos fallidos
- ready before cutoff
- SLO document availability

Buyer Order Tracking
- eventos consumidos
- timeline actualizado
- freshness p95
- SLO tracking < 60s

Technical Drill-down
- SQS backlog
- DLQs
- EC2 health
- RDS latency
- DynamoDB latency
- S3 errors
- IAM denied actions
```

---

# 19. Seguridad e IAM

## Principio

```text
No access keys hardcodeadas.
Cada EC2 usa IAM Role.
Cada servicio tiene permisos mínimos sobre sus recursos.
```

AWS recomienda usar IAM Roles para aplicaciones corriendo en EC2, porque permiten obtener credenciales temporales mediante instance profiles en vez de almacenar access keys dentro de la instancia. ([AWS Documentation][11])

En v2, IAM también aparece como incidente narrativo: un endurecimiento de permisos antes de Black Friday puede bloquear `shipment-preparation` y dejar sellers sin etiqueta. La discusión no es solo “least privilege”, sino cómo mitigar con blast radius controlado y rollback claro.

## Roles

```text
order-management-role
fulfillment-planning-role
shipment-preparation-role
buyer-order-tracking-role
```

## Permisos por servicio

### `order-management-role`

```text
sqs:ReceiveMessage sobre payments-approved-intake
sqs:DeleteMessage sobre payments-approved-intake
sqs:SendMessage sobre orders-confirmed-intake
sqs:SendMessage sobre buyer-tracking-events
cloudwatch:PutMetricData
logs:PutLogEvents
```

### `fulfillment-planning-role`

```text
sqs:ReceiveMessage sobre orders-confirmed-intake
sqs:DeleteMessage sobre orders-confirmed-intake
sqs:SendMessage sobre fulfillment-commitment-intake
sqs:SendMessage sobre buyer-tracking-events
cloudwatch:PutMetricData
logs:PutLogEvents
```

### `shipment-preparation-role`

```text
sqs:ReceiveMessage sobre fulfillment-commitment-intake
sqs:DeleteMessage sobre fulfillment-commitment-intake
sqs:SendMessage sobre buyer-tracking-events
s3:PutObject sobre seller-dispatch-documents/*
s3:GetObject sobre seller-dispatch-documents/*
cloudwatch:PutMetricData
logs:PutLogEvents
```

### `buyer-order-tracking-role`

```text
sqs:ReceiveMessage sobre buyer-tracking-events
sqs:DeleteMessage sobre buyer-tracking-events
dynamodb:GetItem
dynamodb:PutItem
dynamodb:UpdateItem
dynamodb:Query
cloudwatch:PutMetricData
logs:PutLogEvents
```

---

# 20. Red y exposición

## Servicios públicos

Solo deberían exponer HTTP:

```text
order-management
buyer-order-tracking
```

Para laboratorio, `order-management` puede exponer el endpoint que simula `payments-core`.

## Servicios privados

Pueden no tener endpoint público:

```text
fulfillment-planning
shipment-preparation
```

Trabajan consumiendo colas.

## Security Groups

| Servicio               | Inbound                                      |
| ---------------------- | -------------------------------------------- |
| `order-management`     | HTTP 80/8080 desde IPs permitidas            |
| `fulfillment-planning` | Sin inbound público                          |
| `shipment-preparation` | Sin inbound público                          |
| `buyer-order-tracking` | HTTP 80/8080 desde internet o IPs permitidas |
| RDS                    | Solo desde EC2 correspondiente               |
| DynamoDB/SQS/S3        | Acceso vía IAM                               |

---

