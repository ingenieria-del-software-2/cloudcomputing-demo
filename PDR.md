# PDR — Order-to-Ship Marketplace Lab

**Versión:** 1.0
**Contexto:** clase de Cloud Computing aplicada
**Caso de uso:** marketplace estilo MercadoLibre, sin afirmar que esta sea la arquitectura interna real de MercadoLibre
**Restricción principal:** máximo **4 microservicios** desplegables por alumnos
**Arquitectura:** saga coreografiada, event-driven, database-per-service, AWS-first lab

---

# 1. Resumen ejecutivo

La clase deja de ser un recorrido top-down por servicios AWS y pasa a ser una experiencia de arquitectura aplicada:

> Una compra pagada debe convertirse en una orden confirmada, con fulfillment comprometido, shipment listo para despacho y estado visible para el comprador.

El flujo elegido es **Order-to-Ship**, porque combina problemas reales de un marketplace:

```text
pago aprobado
→ orden confirmada
→ stock/fulfillment comprometido
→ shipment preparado
→ tracking visible para comprador
```

La arquitectura usa **4 microservicios máximo**:

| # | Microservicio          | Tipo                      | Responsabilidad                                      |
| - | ---------------------- | ------------------------- | ---------------------------------------------------- |
| 1 | `order-management`     | Participante core de saga | Confirmar y administrar la orden comercial           |
| 2 | `fulfillment-planning` | Participante core de saga | Reservar/allocar stock y comprometer fulfillment     |
| 3 | `shipment-preparation` | Participante core de saga | Crear shipment, documentos, etiqueta e instrucciones |
| 4 | `buyer-order-tracking` | Proyección / read model   | Mantener el estado visible para el comprador         |

El sistema se coordina por eventos, sin un orquestador central. Este patrón calza con una **saga coreografiada**, donde cada servicio ejecuta una transacción local, publica eventos y los siguientes servicios reaccionan a esos eventos. AWS define la saga coreografiada como un patrón para preservar consistencia en transacciones distribuidas mediante suscripciones a eventos, y advierte que funciona mejor cuando hay pocos participantes, justamente lo que buscamos en una clase con máximo 4 servicios. ([AWS Documentation][1])

---

# 2. Objetivo pedagógico

## Objetivo principal

Que los alumnos entiendan Cloud Computing construyendo y operando un flujo de negocio realista, no memorizando servicios aislados.

La clase debe responder preguntas como:

```text
¿Por qué usamos una cola?
¿Por qué cada servicio tiene su base?
¿Qué significa idempotencia?
¿Qué pasa si un servicio se cae?
¿Qué ve el comprador si internamente algo falla?
¿Qué SLO se degrada?
¿Cómo debuggeamos con logs, métricas y eventos?
¿Qué recurso AWS soporta cada capacidad?
```

---

# 3. Problema que queremos modelar

Durante una campaña de alto tráfico, por ejemplo Hot Sale, una orden aprobada no alcanza con “existir”. El negocio necesita que la orden avance rápido y de forma confiable hacia despacho.

## Journey crítico

```text
1. El comprador paga.
2. El pago es aprobado.
3. La orden se confirma comercialmente.
4. Se reserva/alloca stock.
5. Se compromete una promesa de fulfillment.
6. Se crea el shipment.
7. Se generan etiqueta e instrucciones.
8. El comprador ve el estado actualizado.
```

## Dolor de negocio si falla

| Falla                                | Impacto                                      |
| ------------------------------------ | -------------------------------------------- |
| Pago aprobado sin orden visible      | Desconfianza, reclamos, doble compra         |
| Orden confirmada sin stock           | Cancelación, pérdida de reputación, reclamos |
| Promesa logística tardía o inestable | Incertidumbre, consultas a soporte           |
| Shipment sin etiqueta                | El vendedor no puede despachar               |
| Tracking desactualizado              | El comprador no entiende qué pasa            |
| Eventos duplicados mal manejados     | Órdenes duplicadas o estados corruptos       |

---

# 4. Principios de diseño

## 4.1 Business-first, AWS-second

No se enseña:

```text
“Hoy vemos EC2, SQS, S3, RDS...”
```

Se enseña:

```text
“Tenemos que operar una orden de marketplace punta a punta.
¿Qué necesitamos para lograrlo?”
```

Los servicios AWS aparecen como consecuencia:

| Problema de negocio/técnico         | Servicio AWS               |
| ----------------------------------- | -------------------------- |
| Correr microservicios               | EC2                        |
| Conectar servicios asincrónicamente | SQS                        |
| Guardar estado transaccional        | RDS PostgreSQL             |
| Guardar documentos/etiquetas        | S3                         |
| Proyectar tracking buyer-facing     | DynamoDB                   |
| Permisos por servicio               | IAM Roles                  |
| Logs, métricas, SLOs                | CloudWatch                 |
| Repetibilidad y cleanup             | Terraform / CloudFormation |

---

## 4.2 Máximo 4 microservicios

En una arquitectura real grande, probablemente separaríamos:

```text
inventory-reservations
delivery-promises
fulfillment-routing
shipment-creation
shipping-labels
buyer-tracking
notifications
```

Pero para la clase eso sería demasiado. El diseño agrupa responsabilidades para mantener el flujo entendible y operable.

La fusión más importante es:

```text
fulfillment-planning =
  inventory reservation
  + fulfillment routing
  + delivery promise
```

Esto es un compromiso didáctico, no una afirmación de que toda empresa debería fusionarlo así.

---

## 4.3 Database-per-service

Cada microservicio es dueño de su persistencia. Ningún otro servicio le escribe directamente la base.

AWS documenta el patrón **database-per-service** como un patrón donde cada microservicio usa el tipo de base que mejor se adapta a sus necesidades individuales; esto habilita polyglot persistence, por ejemplo combinando bases relacionales y no relacionales según el servicio. ([AWS Documentation][2])

Aplicado acá:

| Servicio               | Persistencia        |
| ---------------------- | ------------------- |
| `order-management`     | RDS PostgreSQL      |
| `fulfillment-planning` | RDS PostgreSQL      |
| `shipment-preparation` | RDS PostgreSQL + S3 |
| `buyer-order-tracking` | DynamoDB            |

---

## 4.4 Eventos de negocio, no eventos técnicos

No usamos nombres como:

```text
sqs_message_sent
worker_done
record_inserted
```

Usamos eventos que comunican negocio:

```text
payments.payment_approved.v1
orders.order_confirmed.v1
fulfillment.commitment_confirmed.v1
shipping.shipment_ready_to_dispatch.v1
customer_experience.order_tracking_updated.v1
```

---

## 4.5 SLIs/SLOs de negocio

Los SLOs deben comunicar dolor real.

No:

```text
sqs_pushed_successfully
http_200_count
ec2_cpu_under_70
```

Sí:

```text
order_confirmation_within_5s_ratio
delivery_promise_created_within_15s_ratio
ready_to_dispatch_before_seller_cutoff_ratio
buyer_tracking_freshness_under_60s_ratio
```

AWS Well-Architected recomienda definir y monitorear SLOs usando percentiles en vez de promedios, porque los percentiles capturan mejor outliers y experiencia degradada. ([AWS Documentation][3])

---

# 5. Validación de nomenclatura y partición

La partición final se apoya en conceptos recurrentes de e-commerce/marketplaces:

```text
Order
Fulfillment
Shipment
Tracking
```

Shopify separa `Order` de `FulfillmentOrder`; su documentación define `FulfillmentOrder` como un ítem o grupo de ítems de una orden que se espera cumplir desde una misma ubicación. Esa separación valida que “orden comercial” y “trabajo de fulfillment” no son lo mismo. ([Shopify][4])

MercadoLibre también expone públicamente documentación separada para ventas, órdenes, pagos y envíos; su documentación de sales habla del flujo para manejar órdenes simples, órdenes de carrito, pagos y shipments. Eso valida el lenguaje de dominio usado, aunque no implica que su arquitectura interna sea esta. ([Mercado Libre Developers][5])

Microsoft, en su guía de microservicios con DDD, usa el ejemplo de un microservicio de Ordering con capas de aplicación, dominio e infraestructura, reforzando que “ordering” suele ser un dominio de negocio propio, no solo CRUD. ([Microsoft Learn][6])

---

# 6. Alcance

## In scope

La clase/demo cubre:

```text
order lifecycle
event-driven architecture
saga coreografiada
database-per-service
RDS PostgreSQL
DynamoDB como read model
S3 para documentos
SQS para eventos entre servicios
IAM Roles por servicio
EC2 como runtime de microservicios
CloudWatch para logs/métricas/SLOs
fallas controladas
cleanup de recursos
```

## Out of scope

No se cubre en la versión base:

```text
Kubernetes
ECS/EKS
API Gateway
Lambda
EventBridge
SNS fanout avanzado
CI/CD completo
Packer / golden images
Blue-green deployment
Autoscaling real
Multi-region
PCI/compliance real de pagos
Fraud detection
Notificaciones push/email
Warehouse management real
Cálculo logístico real
```

Esos temas pueden quedar como extensiones.

---

# 7. Arquitectura lógica

## Vista de alto nivel

```text
payments-core
    |
    | payments.payment_approved.v1
    v
order-management
    |
    | orders.order_confirmed.v1
    v
fulfillment-planning
    |
    | fulfillment.commitment_confirmed.v1
    v
shipment-preparation
    |
    | shipping.shipment_ready_to_dispatch.v1
    v
buyer-order-tracking
```

Pero la vista correcta no es exactamente lineal, porque `buyer-order-tracking` escucha eventos de todos.

```text
payments-core
    |
    v
order-management
    |
    v
fulfillment-planning
    |
    v
shipment-preparation

buyer-order-tracking consume eventos de:
- order-management
- fulfillment-planning
- shipment-preparation
```

---

# 8. Arquitectura AWS propuesta

## Componentes AWS principales

```text
AWS Region
├── VPC / Subnets
├── EC2 instances
├── Security Groups
├── IAM Roles / Instance Profiles
├── Amazon SQS
├── Amazon RDS for PostgreSQL
├── Amazon S3
├── Amazon DynamoDB
└── Amazon CloudWatch
```

## Uso por servicio

| Servicio               | EC2 | SQS | RDS | S3 | DynamoDB | CloudWatch |
| ---------------------- | --: | --: | --: | -: | -------: | ---------: |
| `order-management`     |  Sí |  Sí |  Sí | No |       No |         Sí |
| `fulfillment-planning` |  Sí |  Sí |  Sí | No |       No |         Sí |
| `shipment-preparation` |  Sí |  Sí |  Sí | Sí |       No |         Sí |
| `buyer-order-tracking` |  Sí |  Sí |  No | No |       Sí |         Sí |

---

# 9. Microservicio 1 — `order-management`

## 9.1 Responsabilidad

> Confirmar y administrar el ciclo comercial de una orden a partir de un pago aprobado.

Este servicio es dueño de la verdad comercial inicial de la orden.

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
5. Calcula promesa de entrega.
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

---

# 11. Microservicio 3 — `shipment-preparation`

## 11.1 Responsabilidad

> Convertir un fulfillment comprometido en un shipment listo para despacho.

Este servicio representa shipping operations.

## 11.2 Consume

```text
fulfillment.commitment_confirmed.v1
```

## 11.3 Produce

```text
shipping.shipment_ready_to_dispatch.v1
shipping.dispatch_blocked.v1
shipping.dispatch_document_available.v1
```

## 11.4 Hace

```text
1. Recibe un fulfillment commitment.
2. Crea shipment.
3. Genera etiqueta.
4. Genera instrucciones de despacho.
5. Guarda documentos en S3.
6. Persiste metadata.
7. Publica shipping.shipment_ready_to_dispatch.v1.
```

## 11.5 No hace

```text
No confirma órdenes.
No reserva stock.
No decide promesa logística.
No administra pagos.
No guarda documentos en disco local.
```

## 11.6 Estados internos

```text
SHIPMENT_REQUESTED
SHIPMENT_CREATED
LABEL_GENERATED
DOCUMENTS_AVAILABLE
READY_TO_DISPATCH
DISPATCH_BLOCKED
```

## 11.7 Persistencia

```text
RDS PostgreSQL para metadata transaccional
S3 para documentos físicos/lógicos
```

S3 es un object store basado en buckets y objetos identificados por keys; eso calza con documentos como etiquetas, instrucciones de despacho o comprobantes, que no deberían depender del filesystem local de una EC2. ([AWS Documentation][8])

## 11.8 Modelo de datos mínimo

```sql
shipments (
  shipment_id UUID PRIMARY KEY,
  order_id UUID UNIQUE NOT NULL,
  commitment_id UUID NOT NULL,
  status TEXT NOT NULL,
  seller_cutoff_at TIMESTAMP,
  ready_to_dispatch_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

dispatch_documents (
  document_id UUID PRIMARY KEY,
  shipment_id UUID NOT NULL REFERENCES shipments(shipment_id),
  document_type TEXT NOT NULL,
  s3_bucket TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);
```

## 11.9 S3 object keys

Ejemplo:

```text
shipments/{shipment_id}/labels/shipping-label.pdf
shipments/{shipment_id}/instructions/dispatch-instructions.json
shipments/{shipment_id}/invoices/commercial-invoice.pdf
```

## 11.10 API mínima para laboratorio

```http
GET /shipments/{shipment_id}
GET /shipments/{shipment_id}/documents
GET /health
```

## 11.11 SLOs principales

### SLO 1

```text
ready_to_dispatch_before_seller_cutoff_ratio
```

Definición:

```text
% de órdenes elegibles que llegan a READY_TO_DISPATCH
antes del cutoff del vendedor.
```

Objetivo:

```text
98.5% diario
```

### SLO 2

```text
dispatch_document_availability_on_first_access_ratio
```

Definición:

```text
% de shipments READY_TO_DISPATCH cuya etiqueta/documentación
está disponible en el primer intento de acceso.
```

Objetivo:

```text
99.5% semanal
```

## 11.12 Fallas controladas

| Falla                          | Resultado esperado             |
| ------------------------------ | ------------------------------ |
| IAM sin permiso `s3:PutObject` | `shipping.dispatch_blocked.v1` |
| S3 key mal generada            | Documento no disponible        |
| Servicio apagado               | No hay shipments listos        |
| Evento duplicado               | No duplica shipment            |
| Cutoff vencido                 | Se marca riesgo operativo      |

---

# 12. Microservicio 4 — `buyer-order-tracking`

## 12.1 Responsabilidad

> Mantener una vista materializada del estado visible para el comprador.

Este servicio no es el core transaccional de la saga. Es una proyección customer-facing.

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

# 13. Contrato común de eventos

Todos los eventos deben tener un envelope común.

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

## Happy path

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

# 17. SLOs/SLIs del sistema

## Tabla principal

| Journey                                     | SLI                                                            | SLO            |
| ------------------------------------------- | -------------------------------------------------------------- | -------------- |
| Pago aprobado → orden confirmada            | `% de pagos aprobados que generan orden confirmada en < 5s`    | 99.5% / 7 días |
| Orden confirmada → fulfillment comprometido | `% de órdenes confirmadas con fulfillment commitment en < 15s` | 99.0% / 7 días |
| Orden confirmada → no cancelada por stock   | `% de órdenes sin cancelación por falta de stock`              | 99.95% / mes   |
| Promesa logística estable                   | `% de órdenes cuya fecha prometida no empeora`                 | 97.0% / mes    |
| Commitment → ready to dispatch              | `% de órdenes listas antes del cutoff`                         | 98.5% / día    |
| Documento de despacho                       | `% de shipments con etiqueta disponible al primer acceso`      | 99.5% / semana |
| Estado visible comprador                    | `% de cambios visibles en tracking en < 60s`                   | 99.0% / 7 días |

---

## Métricas técnicas como drill-down

Las métricas técnicas existen, pero no son el tablero principal.

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

---

# 18. Observabilidad

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

## Dashboard sugerido

```text
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

# 21. Modos de despliegue para clase

## Modo A — Una cuenta por grupo

Más simple.

```text
Grupo 1:
- 4 EC2
- 3 RDS pequeñas o 1 RDS con 3 DBs separadas para lab
- 1 DynamoDB
- 1 S3
- 4 SQS + DLQs
```

Para una clase, se puede aceptar **una instancia RDS con varias bases/schema** por costo, aclarando que conceptualmente cada servicio es dueño de su DB.

## Modo B — Una cuenta por alumno

Más realista, más complejo.

```text
Alumno A: order-management
Alumno B: fulfillment-planning
Alumno C: shipment-preparation
Alumno D: buyer-order-tracking
```

Requiere policies cross-account en SQS/S3 y coordinación de ARNs.

## Recomendación

Para primera iteración:

```text
Modo A: una cuenta por grupo
```

Luego, como extensión:

```text
Modo B: cross-account
```

---

# 22. Plan de clase sugerido

## Duración recomendada

```text
3 a 4 horas
```

## Bloque 1 — Contexto y journey

```text
20 min
```

Contenido:

```text
- qué es Order-to-Ship
- por qué no alcanza con “pago aprobado”
- actores: comprador, seller, logística, operaciones
- SLOs del negocio
```

## Bloque 2 — Arquitectura

```text
30 min
```

Contenido:

```text
- microservicios
- eventos
- saga coreografiada
- database-per-service
- AWS components
```

## Bloque 3 — Deploy

```text
45-60 min
```

Actividad:

```text
terraform init
terraform apply
verificación de health checks
```

## Bloque 4 — Happy path

```text
30 min
```

Actividad:

```text
simular pago aprobado
ver orden confirmada
ver fulfillment commitment
ver shipment ready
ver tracking actualizado
```

## Bloque 5 — Incidentes

```text
45-60 min
```

Incidentes:

```text
duplicar payment_id
stock insuficiente
apagar fulfillment-planning
quitar permiso S3
generar tracking lag
```

## Bloque 6 — Cierre

```text
20 min
```

Contenido:

```text
- qué aprendimos de AWS
- qué aprendimos de arquitectura
- qué servicios fueron IaaS/PaaS/managed
- limpieza de recursos
```

---

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

# 24. Incidentes controlados

## Incidente 1 — Pago duplicado

### Acción

Enviar dos veces el mismo payload con `payment_id`.

### Esperado

```text
Una sola orden.
Duplicado ignorado.
Log con DUPLICATE_PAYMENT_IGNORED.
```

### Conceptos

```text
idempotencia
SQS at-least-once
unique constraint
evento duplicado ≠ compra duplicada
```

---

## Incidente 2 — Stock insuficiente

### Acción

Configurar `available_quantity = 0`.

### Esperado

```text
fulfillment.commitment_failed.v1
tracking muestra FULFILLMENT_AT_RISK o CANCELLED
SLO de stock se degrada
```

### Conceptos

```text
consistencia
reserva transaccional
compensación
impacto en comprador
```

---

## Incidente 3 — Apagar `fulfillment-planning`

### Acción

Detener servicio.

### Esperado

```text
orders.order_confirmed.v1 se acumula en SQS
order-management sigue funcionando
no se genera fulfillment commitment
tracking queda en ORDER_CONFIRMED
```

### Conceptos

```text
backlog
degradación parcial
asincronía
SLO de promise latency
```

---

## Incidente 4 — Quitar permiso S3

### Acción

Remover `s3:PutObject` del rol de `shipment-preparation`.

### Esperado

```text
shipping.dispatch_blocked.v1
no hay etiqueta disponible
tracking refleja problema
SLO de document availability se degrada
```

### Conceptos

```text
IAM
least privilege
AccessDenied
debugging con logs
```

---

## Incidente 5 — Tracking lag

### Acción

Detener `buyer-order-tracking`.

### Esperado

```text
La saga core sigue avanzando.
El comprador no ve el estado actualizado.
Se degrada buyer_tracking_freshness_under_60s_ratio.
```

### Conceptos

```text
estado interno vs estado visible
read model
freshness
experiencia percibida
```

---

# 25. Entregables de los alumnos

Cada grupo debe entregar:

```text
1. Diagrama de arquitectura final.
2. URL de order-management.
3. URL de buyer-order-tracking.
4. Lista de colas SQS.
5. Lista de eventos producidos/consumidos.
6. Captura o evidencia del happy path.
7. Evidencia de un incidente controlado.
8. Logs con correlation_id.
9. Explicación de un SLO degradado.
10. Ejecución de cleanup.
```

---

# 26. Rúbrica de evaluación

| Criterio                                | Peso |
| --------------------------------------- | ---: |
| Microservicios despliegan correctamente |  20% |
| Happy path end-to-end funciona          |  20% |
| Eventos tienen contrato claro           |  10% |
| Idempotencia ante duplicados            |  10% |
| Uso correcto de DB por servicio         |  10% |
| IAM sin access keys hardcodeadas        |  10% |
| Observabilidad con logs/correlation_id  |  10% |
| Explicación de SLO/SLI de negocio       |  10% |

---

# 27. Riesgos y mitigaciones

## Riesgo 1 — RDS aumenta costo y tiempo

Mitigación:

```text
Usar una sola instancia RDS por grupo con DB/schema separados.
Aclarar que conceptualmente son DBs por servicio.
```

## Riesgo 2 — Demasiadas piezas para una clase

Mitigación:

```text
Proveer Terraform ya armado.
Proveer servicios Dockerizados.
Tener servicios docentes fallback.
```

## Riesgo 3 — Cross-account complica IAM

Mitigación:

```text
Primera iteración en una cuenta por grupo.
Cross-account como extensión.
```

## Riesgo 4 — DynamoDB parece metido a la fuerza

Mitigación:

```text
Usarlo solo en buyer-order-tracking como read model.
No usar DynamoDB para órdenes ni fulfillment.
```

## Riesgo 5 — Los alumnos se enfocan en AWS Console y no en negocio

Mitigación:

```text
Dashboard de negocio primero.
Consola AWS solo para debugging.
```

---

# 28. Decisiones arquitectónicas

## ADR-001 — Saga coreografiada

**Decisión:** usar saga coreografiada, no orquestada.

**Motivo:**

```text
- máximo 4 participantes
- evita orquestador central
- permite enseñar eventos
- permite mostrar fallas y compensaciones
```

**Tradeoff:**

```text
- más difícil razonar globalmente
- requiere buenos eventos
- requiere observabilidad
```

---

## ADR-002 — Máximo 4 microservicios

**Decisión:** usar 4 microservicios.

**Motivo:**

```text
- manejable en clase
- cada alumno/grupo puede operar una capacidad
- evita arquitectura artificialmente grande
```

**Tradeoff:**

```text
fulfillment-planning agrupa responsabilidades que podrían separarse.
```

---

## ADR-003 — RDS PostgreSQL para servicios transaccionales

**Decisión:** usar RDS PostgreSQL en:

```text
order-management
fulfillment-planning
shipment-preparation
```

**Motivo:**

```text
- dominios relacionales
- queries de debug más simples
- constraints útiles
- modelo comprensible para alumnos
```

---

## ADR-004 — DynamoDB solo para tracking

**Decisión:** usar DynamoDB solo en:

```text
buyer-order-tracking
```

**Motivo:**

```text
- read model denormalizado
- access patterns claros
- consulta por order_id/buyer_id
- no necesita joins
```

**Tradeoff:**

```text
No se usa como base relacional general.
No se fuerza DynamoDB en dominios donde PostgreSQL es más natural.
```

---

## ADR-005 — S3 para documentos

**Decisión:** usar S3 para etiquetas e instrucciones.

**Motivo:**

```text
- documentos como objetos
- no depender del disco de EC2
- metadata y keys claras
```

---

## ADR-006 — EC2 como runtime

**Decisión:** desplegar microservicios en EC2.

**Motivo pedagógico:**

```text
- conecta con IaaS
- permite ver SSH/Session Manager
- permite hablar de Security Groups
- permite roles de EC2
- mantiene visible el concepto de VM
```

---

# 29. Recursos AWS por grupo

## Mínimo recomendado

```text
4 EC2 t3.micro o equivalente
1 RDS PostgreSQL pequeño
1 DynamoDB table
1 S3 bucket
4 SQS queues
4 SQS DLQs
4 IAM roles
4 Security Groups
CloudWatch Logs
```

## Nombres sugeridos

```text
team-01-order-management-lab
team-01-fulfillment-planning-lab
team-01-shipment-preparation-lab
team-01-buyer-order-tracking-lab

team-01-payments-approved-intake
team-01-orders-confirmed-intake
team-01-fulfillment-commitment-intake
team-01-buyer-tracking-events

team-01-seller-dispatch-documents
team-01-buyer-visible-order-state
```

---

# 30. Cleanup

Al final de la clase:

```text
1. Borrar objetos de S3.
2. Borrar CloudFormation stacks o terraform destroy.
3. Verificar EC2 terminadas.
4. Verificar RDS eliminado.
5. Verificar snapshots no deseados.
6. Verificar SQS eliminadas.
7. Verificar DynamoDB eliminada.
8. Verificar buckets eliminados.
```

Checklist:

```text
[ ] No hay EC2 running
[ ] No hay RDS running
[ ] No hay buckets con objetos
[ ] No hay colas SQS
[ ] No hay tablas DynamoDB
[ ] No hay Elastic IPs
[ ] No hay Load Balancers
```

---

# 31. Criterio de éxito de la demo

La demo se considera exitosa si:

```text
1. Se simula un pago aprobado.
2. Se crea una orden.
3. Se publica orders.order_confirmed.v1.
4. Se reserva stock.
5. Se compromete fulfillment.
6. Se crea shipment.
7. Se genera documento en S3.
8. Se actualiza tracking del comprador.
9. Se puede consultar GET /orders/{order_id}/tracking.
10. Se provoca al menos una falla y se diagnostica con logs/métricas.
```

Resultado esperado final:

```text
PAYMENT_APPROVED
→ ORDER_CONFIRMED
→ FULFILLMENT_COMMITTED
→ READY_TO_DISPATCH
→ BUYER_TRACKING_UPDATED
```

---

# 32. Cierre conceptual para la clase

Al final, se vuelve a la teoría:

| Concepto cloud          | Dónde apareció                        |
| ----------------------- | ------------------------------------- |
| IaaS                    | EC2                                   |
| PaaS / managed services | RDS, SQS, S3, DynamoDB                |
| IAM                     | Roles por servicio                    |
| Broad network access    | APIs HTTP                             |
| Measured service        | Costos por requests, storage, compute |
| Elasticity              | Backlog de SQS y workers              |
| Resource pooling        | Infra AWS compartida                  |
| IaC                     | Terraform/CloudFormation              |
| Observability           | CloudWatch                            |
| Saga                    | Coordinación por eventos              |
| Polyglot persistence    | RDS + DynamoDB + S3                   |

La frase de cierre:

> **No construimos una demo de AWS. Construimos un flujo de negocio de marketplace y usamos AWS para hacerlo ejecutable, observable, seguro y repetible.**

[1]: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-choreography.html?utm_source=chatgpt.com "Saga choreography pattern - AWS Prescriptive Guidance"
[2]: https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/database-per-service.html?utm_source=chatgpt.com "Database-per-service pattern - AWS Prescriptive Guidance"
[3]: https://docs.aws.amazon.com/wellarchitected/latest/devops-guidance/o.si.5-set-and-monitor-service-level-objectives-against-performance-standards.html?utm_source=chatgpt.com "[O.SI.5] Set and monitor service level objectives against ..."
[4]: https://shopify.dev/docs/api/admin-graphql/latest/objects/FulfillmentOrder?utm_source=chatgpt.com "FulfillmentOrder - GraphQL Admin"
[5]: https://developers.mercadolibre.com.ar/en_us/manage-sales?utm_source=chatgpt.com "Sales"
[6]: https://learn.microsoft.com/es-es/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice?utm_source=chatgpt.com "Diseño de un microservicio orientado a DDD - .NET"
[7]: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html?utm_source=chatgpt.com "Amazon RDS for PostgreSQL"
[8]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingObjects.html?utm_source=chatgpt.com "Amazon S3 objects overview"
[9]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html?utm_source=chatgpt.com "What is Amazon DynamoDB? - Amazon DynamoDB"
[10]: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html?utm_source=chatgpt.com "Amazon SQS queue types - Amazon Simple Queue Service"
[11]: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/ec2-iam-roles.html?utm_source=chatgpt.com "Read IAM role credentials on Amazon EC2 using the SDK ..."
