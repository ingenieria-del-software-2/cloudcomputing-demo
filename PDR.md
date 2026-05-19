# PDR v2 — Black Friday SRE GameDay: Order-to-Ship Marketplace Lab

**Versión:** 2.0
**Contexto:** clase de Cloud Computing aplicada como war room SRE
**Caso de uso:** marketplace ficticio `MercadoFuego`, inspirado en marketplaces tipo MercadoLibre, sin afirmar ni sugerir que esta sea su arquitectura interna real
**Evento:** Black Friday / Hot Sale
**Feature problemática:** `Promesa Express`
**Restricción principal:** máximo **4 microservicios** desplegables por alumnos
**Arquitectura:** saga coreografiada, event-driven, database-per-service, AWS-first lab usado como escenario de incidente

---

# 1. Resumen ejecutivo

La clase deja de ser un recorrido top-down por servicios AWS y pasa a ser una experiencia de operación bajo presión.

Durante un evento tipo Black Friday, un marketplace ficticio llamado **MercadoFuego** lanza una nueva feature de checkout llamada **Promesa Express** y, al mismo tiempo, distintos equipos de infraestructura aplican cambios no coordinados. El sistema no está completamente caído: está peor. Algunas compras avanzan, otras se demoran, algunas quedan inconsistentes y el tracking visible para el comprador no siempre refleja la verdad interna.

La clase entra como **equipo SRE de guardia**. Su misión no es dejar una arquitectura perfecta, sino recuperar un flujo crítico defendible:

```text
pago aprobado
→ orden confirmada
→ fulfillment comprometido
→ shipment preparado
→ tracking visible para comprador
```

Durante la crisis, ese flujo se ve degradado:

```text
pago aprobado
→ orden confirmada tarde o duplicada
→ fulfillment se atrasa o falla
→ shipment queda bloqueado
→ tracking visible miente o queda viejo
```

La pregunta central ya no es:

```text
¿Podemos construir este flujo?
```

La pregunta pasa a ser:

```text
¿Qué sacrificamos, revertimos o degradamos para que el usuario todavía pueda comprar?
```

El sistema se divide en **4 microservicios máximo**, desplegados por voluntarios con Terraform. El resto de la clase actúa como war room: define SLOs de emergencia, prioriza síntomas, decide mitigaciones, evalúa trade-offs y exige evidencia.

La clase no busca memorizar servicios AWS. Busca practicar decisiones de arquitectura y operación:

```text
¿Qué flujo salva el negocio?
¿Qué métrica representa dolor del usuario?
¿Qué cambio revertimos primero?
¿Qué feature degradamos?
¿Cuándo escalar ayuda y cuándo amplifica el problema?
¿Qué evidencia necesitamos para confiar en el sistema?
¿Qué aprendimos para que el incidente no dependa de héroes?
```

Los microservicios se presentan como responsabilidades de negocio bajo presión, no como CRUDs:

| # | Microservicio          | Rol en el incidente                                                        |
| - | ---------------------- | -------------------------------------------------------------------------- |
| 1 | `order-management`     | Protege que un pago aprobado no cree caos comercial                        |
| 2 | `fulfillment-planning` | Decide si podemos cumplir lo vendido bajo presión                          |
| 3 | `shipment-preparation` | Convierte promesa en algo despachable; su falla bloquea sellers            |
| 4 | `buyer-order-tracking` | Representa la verdad percibida por el comprador; si miente, soporte arde   |

El sistema se coordina por eventos, sin un orquestador central. Este patrón calza con una **saga coreografiada**, donde cada servicio ejecuta una transacción local, publica eventos y los siguientes servicios reaccionan a esos eventos. AWS define la saga coreografiada como un patrón para preservar consistencia en transacciones distribuidas mediante suscripciones a eventos, y advierte que funciona mejor cuando hay pocos participantes, justamente lo que buscamos en una clase con máximo 4 servicios. ([AWS Documentation][1])

La frase operativa del PDR v2 es:

> No buscamos producción perfecta. Buscamos producción defendible.

---

# 2. Objetivo pedagógico

## Objetivo principal

Que los alumnos entiendan Cloud Computing recuperando confiabilidad bajo presión, no memorizando servicios aislados ni admirando una arquitectura ideal.

La arquitectura no es la solución en sí misma. Es el escenario donde se manifiestan malas decisiones, acoplamientos, deuda técnica, fallas parciales y trade-offs reales.

> Esta arquitectura no está para ser admirada. Está para ser interrogada bajo presión.

La clase debe responder preguntas como:

```text
¿Qué significa estar mal si el sistema todavía responde?
¿Qué flujo crítico salva el negocio?
¿Qué SLO representa dolor real del comprador?
¿Qué feature degradamos para proteger checkout?
¿Qué cambio de infraestructura revertimos primero?
¿Cuándo escalar workers arregla el problema y cuándo solo lo encarece?
¿Qué significa idempotencia?
¿Qué ve el comprador si internamente la saga avanzó pero el read model quedó viejo?
¿Qué evidencia necesitamos para confiar en una mitigación?
¿Cómo usamos Terraform para auditar, repetir, romper, revertir y limpiar?
```

---

# 3. Problema que queremos modelar

Durante Black Friday, una orden aprobada no alcanza con “existir”. El negocio necesita que la orden avance rápido, de forma confiable y con un estado visible honesto para el comprador.

El problema no arranca con un sistema sano. Arranca con una producción heredada y degradada por cambios simultáneos:

```text
23:20 Infra ajusta workers, concurrencia y timeouts.
23:35 Seguridad cambia permisos IAM.
23:40 Observabilidad sube logging y métricas “para ver mejor”.
23:50 Producto activa Promesa Express.
00:00 Black Friday empieza.
00:03 Soporte reporta reclamos.
00:08 Fulfillment ve backlog.
00:12 Tracking visible queda atrasado.
```

La nueva feature **Promesa Express** intenta mostrar una promesa comercial más atractiva:

```text
Comprá ahora y llega mañana.
```

La feature es valiosa para conversión, pero mete presión sobre stock, fulfillment, generación de shipment y tracking visible.

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

## Journey degradado durante Black Friday

```text
1. El comprador paga.
2. El pago es aprobado.
3. La orden se confirma tarde o se intenta duplicar.
4. Fulfillment se atrasa por backlog o Promesa Express.
5. Shipment queda bloqueado por permisos o documentos.
6. El tracking visible queda viejo o muestra un estado engañoso.
7. Soporte recibe reclamos aunque varios servicios sigan “up”.
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
| Promesa Express degradando checkout  | Se protege una feature y se sacrifica compra |
| Backlog silencioso                   | El sistema está vivo pero incumple el SLO    |
| Cambio IAM mal coordinado            | Sellers no pueden despachar                  |

---

# 4. Principios de diseño

## 4.1 Incidente-first / SRE-first

La clase no abre con una arquitectura ideal. Abre con un incidente vivo.

Antes:

```text
Deploy → happy path → incidentes
```

Ahora:

```text
Contexto de crisis → SLO de emergencia → deploy mínimo → síntomas → mitigación → evidencia → postmortem
```

El happy path no desaparece, pero cambia de rol. Ya no es el gran logro. Es apenas una prueba inicial:

> Este caso funcionó. ¿Pero podemos confiar en esto durante Black Friday?

---

## 4.2 Business-first, AWS-second

No se enseña:

```text
“Hoy vemos EC2, SQS, S3, RDS...”
```

Se enseña:

```text
“Tenemos que operar una orden de marketplace punta a punta.
¿Qué necesitamos para lograrlo?”
```

Los servicios AWS aparecen como consecuencia de capacidades necesarias, no como catálogo:

| Necesidad                    | AWS aparece como           |
| ---------------------------- | -------------------------- |
| Correr servicios clásicos    | EC2                        |
| Comunicación asíncrona       | SQS                        |
| Estado transaccional         | RDS PostgreSQL             |
| Documentos/etiquetas         | S3                         |
| Tracking visible/read model  | DynamoDB                   |
| Evidencia/logs/métricas      | CloudWatch                 |
| Responsabilidad por servicio | IAM Roles                  |
| Repetibilidad/rollback       | Terraform / CloudFormation |

---

## 4.3 SLO de journey como volante

El primer problema del war room no es AWS. Es este:

> No sabemos qué significa estar mal.

La clase define un SLO de emergencia antes de optimizar recursos o tocar demasiadas perillas.

SLO principal del taller:

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

Objetivo de emergencia:

```text
95% durante la ventana crítica del taller
```

AWS Well-Architected recomienda definir y monitorear SLOs usando percentiles en vez de promedios, porque los percentiles capturan mejor outliers y experiencia degradada. ([AWS Documentation][3])

Regla didáctica:

> Primero el usuario. Después el recurso.

---

## 4.4 Máximo 4 microservicios

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

En v2, estos servicios se asignan a 3 roles de voluntarios:

| Voluntario   | Rol narrativo                   | Microservicios / capacidades                    |
| ------------ | ------------------------------- | ----------------------------------------------- |
| Voluntario 1 | Checkout / Order Team           | `order-management` + entrada de pagos simulada  |
| Voluntario 2 | Fulfillment / Shipping Team     | `fulfillment-planning` + `shipment-preparation` |
| Voluntario 3 | SRE / Buyer Experience Team     | `buyer-order-tracking` + observabilidad         |

---

## 4.5 Database-per-service

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

## 4.6 Eventos de negocio, no eventos técnicos

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

Cada evento debe permitir reconstruir una compra con `correlation_id`. Sin esa evidencia, la war room discute opiniones en vez de hechos.

---

## 4.7 Graceful degradation y rollback discipline

Durante un incidente, la pregunta no es “qué arquitectura nos gusta más”, sino qué acción reduce dolor del usuario con menor riesgo.

Decisiones esperadas:

```text
apagar Promesa Express
degradarla a una promesa genérica
mantenerla solo para ciertos sellers
aislarla del camino crítico
revertir un cambio de workers
corregir o acotar un permiso IAM
congelar cambios no críticos
```

La feature comercial no manda por encima del flujo crítico. Si `Promesa Express` degrada checkout, se apaga o se degrada.

---

## 4.8 SLIs/SLOs de negocio

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

La clase/demo cubre el sistema técnico y la dinámica de operación:

```text
order lifecycle
event-driven architecture
saga coreografiada
database-per-service
SLO de emergencia centrado en usuario
war room SRE
timeline de incidente
graceful degradation
rollback discipline
feature flags conceptuales
idempotencia bajo retries
backpressure y backlog
RDS PostgreSQL
DynamoDB como read model
S3 para documentos
SQS para eventos entre servicios
IAM Roles por servicio
EC2 como runtime de microservicios
CloudWatch para logs/métricas/SLOs
fallas controladas
nota de guardia / postmortem de bolsillo
cleanup de recursos
```

## Out of scope

No se cubre en la versión base:

```text
producción perfecta
evaluación formal con rúbrica pesada
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

## Cómo usar este PDR

El documento queda organizado en dos capas:

| Capa | Uso en clase | Contenido |
| ---- | ------------ | --------- |
| Narrativa/pedagógica | Guía principal del GameDay | storytelling, roles, SLO, etapas, decisiones, incidentes, postmortem |
| Técnica de soporte | Apéndice operativo | microservicios, eventos, schemas, AWS, Terraform, IAM, cleanup |

La clase no recorre linealmente todo el apéndice técnico. Lo usa como respaldo cuando la war room necesita evidencia o contexto.

---

# 7. Arquitectura lógica

## Vista de alto nivel

La arquitectura se presenta como una producción heredada que hay que operar durante Black Friday. No es una solución perfecta; es el escenario donde la clase va a buscar síntomas, causas probables, mitigaciones y evidencia.

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

Durante el incidente, la vista lineal ayuda a explicar el journey, pero la operación real exige mirar atrasos, duplicados, DLQs, freshness del read model y errores de permisos.

---

# 8. Arquitectura AWS propuesta

La arquitectura AWS no se introduce como catálogo de servicios. Se introduce desde capacidades necesarias para recuperar el flujo crítico:

| Necesidad durante el incidente       | Servicio / práctica             |
| ------------------------------------ | ------------------------------- |
| Ejecutar los microservicios          | EC2                             |
| Desacoplar servicios y absorber pico | SQS                             |
| Persistir estado transaccional       | RDS PostgreSQL                  |
| Guardar etiquetas/documentos         | S3                              |
| Consultar estado visible rápido      | DynamoDB                        |
| Ver evidencia y medir SLOs           | CloudWatch                      |
| Acotar responsabilidades             | IAM Roles                       |
| Repetir, revertir y limpiar cambios  | Terraform / CloudFormation      |

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

# 11. Microservicio 3 — `shipment-preparation`

## 11.1 Responsabilidad

> Convertir un fulfillment comprometido en un shipment listo para despacho.

Este servicio representa shipping operations.

En la historia Black Friday, convierte una promesa comercial en algo despachable. Si falla por permisos o documentos, los sellers quedan bloqueados aunque la orden y el fulfillment parezcan correctos.

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

En la historia Black Friday, representa la verdad percibida por el comprador. Si queda vieja o muestra un estado engañoso, soporte arde aunque los servicios internos hayan avanzado.

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

# 21. Modos de despliegue para clase

## Modo principal v2 — Una cuenta, 3 voluntarios

Es el modo recomendado para el GameDay. Reduce coordinación de cuentas y permite que el aula se enfoque en contratos, síntomas, SLOs y mitigaciones.

```text
Voluntario 1: Checkout / Order Team
- order-management
- entrada de pagos simulada

Voluntario 2: Fulfillment / Shipping Team
- fulfillment-planning
- shipment-preparation

Voluntario 3: SRE / Buyer Experience Team
- buyer-order-tracking
- tablero de incidente
- health checks
- evidencia con correlation_id
```

Recursos por grupo:

```text
- 4 EC2 o menos si se agrupan servicios para el laboratorio
- 3 RDS pequeñas o 1 RDS con 3 DBs/schemas separados para lab
- 1 DynamoDB
- 1 S3
- 4 SQS + DLQs
- CloudWatch Logs/Metrics
```

Para una clase, se puede aceptar **una instancia RDS con varias bases/schema** por costo, aclarando que conceptualmente cada servicio es dueño de su DB.

## Modo alternativo — 4 voluntarios

Si aparece un cuarto voluntario, se puede separar `shipment-preparation` y dejar `buyer-order-tracking`/SRE como rol dedicado.

| Voluntario | Servicio / rol                  |
| ---------- | ------------------------------- |
| 1          | `order-management`              |
| 2          | `fulfillment-planning`          |
| 3          | `shipment-preparation`          |
| 4          | `buyer-order-tracking` / SRE    |

## Extensión — Una cuenta por alumno

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
Modo principal v2: una cuenta por grupo con 3 voluntarios
```

Luego, como extensión:

```text
Modo B: cross-account
```

---

# 22. Plan de clase sugerido

## Duración recomendada

```text
3 horas
```

## 0:00–0:15 — Apertura: Black Friday en llamas

```text
Contexto narrativo.
Roles.
Flujo crítico.
Mapa mental del incidente.
```

Storytelling:

```text
Son las 23:55.
MercadoFuego abre Black Friday en 5 minutos.
Producto lanzó Promesa Express.
Infra aplicó optimizaciones.
Seguridad ajustó permisos.
Observabilidad subió el nivel de logs.

A las 00:03 hay reclamos, backlog, tracking atrasado y sellers sin etiquetas.
```

Pregunta al aula:

> ¿Cuál es el flujo que no puede romperse aunque todo lo demás se degrade?

Done de etapa:

```text
[ ] El negocio está entendido.
[ ] El flujo crítico está identificado.
[ ] Los equipos están asignados.
[ ] La clase entiende que no vamos a optimizar todo.
```

## 0:15–0:30 — SLO de emergencia

```text
Elegir SLI/SLO.
Separar dolor de usuario de métricas técnicas.
Declarar severidad.
```

Pregunta al aula:

> ¿Qué métrica representa dolor del comprador?

SLO inicial sugerido:

```text
El 95% de pagos aprobados debe llegar a tracking visible
en menos de 2 minutos,
sin duplicar órdenes
y sin vender stock inexistente.
```

Checklist:

```text
[ ] Elegimos un flujo crítico.
[ ] Elegimos 1 o 2 SLIs.
[ ] Definimos umbral y ventana.
[ ] Diferenciamos métrica de negocio vs métrica técnica.
[ ] Declaramos severidad del incidente.
```

## 0:30–0:55 — Deploy mínimo por voluntarios

```text
Voluntario 1: order/checkout.
Voluntario 2: fulfillment/shipping.
Voluntario 3: tracking/SRE.
```

Actividad:

```text
terraform init
terraform apply
verificación de health checks
outputs mínimos compartidos
correlation_id visible en logs
```

Pregunta al aula:

> ¿Qué depende de quién?

Done de etapa:

```text
[ ] order-management responde.
[ ] fulfillment/shipment están activos.
[ ] buyer-tracking responde.
[ ] Se puede simular un pago aprobado.
[ ] Hay logs con correlation_id.
[ ] Hay cleanup preparado.
```

## 0:55–1:15 — Happy path sospechoso

```text
Simular pago aprobado.
Ver orden.
Ver fulfillment.
Ver shipment.
Ver tracking.
```

Actividad:

```text
simular pago aprobado
ver orden confirmada
ver fulfillment commitment
ver shipment ready
ver tracking actualizado
```

Pregunta al aula:

> ¿Esto prueba salud o solo ausencia momentánea de evidencia?

Done de etapa:

```text
[ ] Hay una orden visible.
[ ] Hay stock reservado.
[ ] Hay shipment/documento.
[ ] Hay tracking visible.
[ ] Se puede reconstruir el recorrido con logs/eventos.
```

## 1:15–1:40 — Incidente Promesa Express

```text
La feature nueva intenta prometer “llega mañana”.
Durante Black Friday aumenta latencia y errores en fulfillment.
Tracking queda congelado en ORDER_CONFIRMED.
```

Pregunta madre:

> ¿Qué mata más negocio: apagar Promesa Express o degradar checkout?

Mitigaciones posibles:

```text
apagar Promesa Express
degradarla a promesa genérica
mantenerla solo para ciertos sellers
aislarla del camino crítico
limitar retries o concurrencia
```

Concepto SRE:

```text
Graceful degradation
```

## 1:40–1:50 — Pausa corta

Tres horas sin pausa degrada la clase igual que un sistema sin backpressure.

## 1:50–2:15 — Incidente cambios de infra

```text
Timeline.
Permisos/shipment/logging/workers.
Elegir rollback o freeze.
```

Timeline base:

```text
23:20 Infra ajusta workers/concurrencia.
23:35 Seguridad cambia permisos.
23:40 Observabilidad sube logging.
23:50 Producto activa Promesa Express.
00:00 Black Friday empieza.
00:03 reclamos.
00:08 backlog.
00:12 tracking atrasado.
```

Pregunta al aula:

> ¿Rollback de qué, si cambiaron cinco cosas?

Checklist:

```text
[ ] Construimos timeline del incidente.
[ ] Separamos síntomas de cambios candidatos.
[ ] Elegimos primer rollback o mitigación.
[ ] Congelamos cambios no críticos.
[ ] Definimos qué evidencia esperamos ver si funciona.
```

Concepto SRE:

```text
Change management + rollback discipline
```

## 2:15–2:40 — Backlog, shipment y tracking

```text
El sistema no cae; se atrasa.
order-management sigue aceptando pagos.
fulfillment acumula cola.
shipment falla por permisos o documentos.
tracking visible queda viejo.
```

Preguntas:

```text
¿Escalar arregla el incidente o solo lo hace más caro?
¿Aceptaríamos un permiso más amplio por 30 minutos?
¿El sistema está vivo si el comprador ve una mentira?
```

Decisiones posibles:

```text
escalar workers selectivamente
limitar entrada
priorizar eventos críticos
corregir permiso mínimo
aplicar permiso temporal con expiración
mostrar estado visible menos engañoso
```

Conceptos SRE:

```text
Backpressure
Queueing
Retries
Idempotencia
Mitigación controlada
Blast radius
User-facing reliability
```

## 2:40–2:55 — Postmortem de bolsillo

La pregunta incorrecta es:

```text
¿Quién rompió producción?
```

La pregunta correcta es:

```text
¿Qué condiciones hicieron razonable que esto pasara?
```

Formato de nota:

```text
Impacto:
Síntoma principal:
SLO degradado:
Cambios contribuyentes:
Mitigación aplicada:
Riesgo aceptado:
Acción preventiva:
Qué no volveríamos a hacer:
```

Pregunta final:

> ¿Qué guardrail habría prevenido esto sin pedirle a la gente que sea perfecta?

## 2:55–3:00 — Cleanup y cierre conceptual

```text
terraform destroy
verificación de recursos eliminados
cierre conceptual
```

Frase posible:

> Hoy usamos AWS. El problema real no era AWS. Era sostener una promesa de negocio cuando tráfico, cambios y deuda técnica llegan todos juntos a producción.

## State of done por etapa

| Etapa            | Done narrativo                | Evidencia mínima                  | Decisión del aula              |
| ---------------- | ----------------------------- | --------------------------------- | ------------------------------ |
| Briefing         | Flujo crítico identificado    | Mapa simple Order-to-Ship         | Qué salva el negocio           |
| SLO emergencia   | SLO elegido                   | SLI + umbral + ventana            | Qué métrica manda              |
| Deploy mínimo    | Partes activas                | Health checks / outputs Terraform | Qué contrato une equipos       |
| Happy path       | Una compra fluye              | Tracking final + correlation_id   | Si confiamos o no              |
| Feature falla    | Promesa Express degrada flujo | Latencia/backlog/error visible    | Apagar, degradar o aislar      |
| Infra changes    | Timeline armado               | Lista de cambios                  | Qué revertir primero           |
| Backlog          | Sistema atrasado, no caído    | Queue depth / tracking lag        | Escalar, limitar o priorizar   |
| Shipment blocked | Documento/etiqueta falla      | Error de permiso o storage        | Fix mínimo vs permiso temporal |
| Tracking stale   | Comprador ve estado viejo     | Freshness degradada               | Qué estado mostrar             |
| Postmortem       | Aprendizaje registrado        | Nota de incidente                 | Guardrail futuro               |

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

# 25. Entregable liviano de clase — Nota de guardia

No hay evaluación formal pesada. El cierre operativo es una mini nota de guardia/postmortem que capture impacto, evidencia y decisión.

Formato sugerido:

```text
Incidente:
Black Friday / Order-to-Ship degradado

Impacto:
Compradores con pagos aprobados no veían tracking actualizado.
Sellers no recibían shipment listo a tiempo.
Fulfillment acumulaba backlog.

SLO afectado:
order_to_buyer_visible_tracking_under_2m_ratio

Síntoma principal:
Tracking lag + backlog en fulfillment/shipment.

Cambios contribuyentes:
Promesa Express activada.
Workers modificados.
Permisos de shipment ajustados.
Logging elevado.

Mitigación:
Desactivar o degradar Promesa Express.
Corregir permiso de documentos.
Priorizar eventos críticos.
Reducir ruido de logs.

Riesgo aceptado:
Promesa logística menos precisa durante la ventana crítica.

Acción preventiva:
Freeze de cambios antes de eventos.
Feature flags obligatorios.
SLO de journey antes de launch.
Runbook de rollback.
```

Evidencia mínima esperada:

```text
1. Tracking final o estado visible at-risk.
2. correlation_id usado para reconstruir una compra.
3. Log o métrica que muestre degradación.
4. Decisión explícita de mitigación.
5. Riesgo aceptado.
6. Acción preventiva.
7. Cleanup ejecutado o instrucción clara de destrucción.
```

---

# 26. Criterios de éxito de la experiencia

La clase fue exitosa si los alumnos pueden explicar:

```text
1. Por qué el flujo crítico no es “checkout” solamente.
2. Por qué una orden pagada puede seguir siendo un incidente.
3. Qué SLO representa dolor real del comprador.
4. Por qué un sistema puede estar up y aun así estar mal.
5. Qué feature conviene degradar primero.
6. Qué cambio de infra conviene revertir primero.
7. Por qué idempotencia importa durante retries.
8. Por qué tracking viejo puede ser un problema de confiabilidad.
9. Cómo Terraform ayuda a auditar cambios y no solo a crear recursos.
10. Qué guardrail habría evitado repetir el incidente.
```

No buscamos una producción perfecta. Buscamos que la clase pueda defender una decisión operativa con evidencia.

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

## Riesgo 6 — La narrativa tapa la ejecución técnica

Mitigación:

```text
Mantener comandos de demo mínimos.
Tener Terraform y servicios fallback.
Exigir evidencia concreta: health check, log, evento, métrica o tracking.
```

## Riesgo 7 — El SLO de journey es difícil de medir en vivo

Mitigación:

```text
Usar correlation_id y timestamps en eventos.
Aceptar medición didáctica con logs si no hay tablero completo.
Separar SLO principal de métricas técnicas de drill-down.
```

---

# 28. Decisiones arquitectónicas y pedagógicas

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

## ADR-007 — SRE-first GameDay

**Decisión:** la clase se estructura como incidente SRE, no como despliegue lineal.

**Motivo:**

```text
- alumnos avanzados
- evita clase catálogo de AWS
- obliga a decidir bajo presión
- conecta arquitectura con operación
```

**Tradeoff:**

```text
- menos tiempo para explicar cada servicio
- requiere buen storytelling y fallback docente
```

---

## ADR-008 — SLO de journey como métrica principal

**Decisión:** usar un SLO principal de Order-to-Ship visible para comprador.

**Motivo:**

```text
- evita perseguir CPU/memoria como objetivo
- centra la clase en dolor de usuario
- obliga a razonar end-to-end
```

**Tradeoff:**

```text
- más difícil de medir que una métrica técnica simple
- requiere correlation_id, eventos y logs consistentes
```

---

## ADR-009 — Degradar features no críticas

**Decisión:** `Promesa Express` puede apagarse o degradarse para proteger el flujo de compra.

**Motivo:**

```text
- enseña graceful degradation
- muestra que confiabilidad también es decisión de producto
- protege el flujo crítico durante Black Friday
```

**Tradeoff:**

```text
- menor conversión o peor experiencia temporal
- promesa logística menos precisa durante la ventana crítica
```

---

## ADR-010 — Cambios congelados durante incidente

**Decisión:** durante el incidente se congelan cambios no críticos.

**Motivo:**

```text
- reduce incertidumbre
- permite aislar variables
- evita que la mitigación genere nuevos síntomas
```

**Tradeoff:**

```text
- puede bloquear mejoras legítimas
- requiere disciplina organizacional
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

La demo se considera exitosa si la war room puede afirmar:

```text
1. Identificamos el flujo crítico que salva el negocio.
2. Definimos un SLO de emergencia centrado en usuario.
3. Desplegamos o activamos las partes mínimas del sistema.
4. Probamos el camino Order-to-Ship al menos una vez.
5. Detectamos una degradación realista durante Black Friday.
6. Aplicamos una mitigación defendible.
7. Distinguimos causa probable, síntoma y acción de contención.
8. Dejamos evidencia con correlation_id, logs, eventos o métricas.
9. Tomamos una decisión explícita sobre qué sacrificar.
10. Cerramos con una nota de incidente y una acción preventiva.
11. Ejecutamos cleanup o dejamos claro cómo destruir recursos.
```

Resultado técnico mínimo esperado:

```text
PAYMENT_APPROVED
→ ORDER_CONFIRMED
→ FULFILLMENT_COMMITTED
→ READY_TO_DISPATCH
→ BUYER_TRACKING_UPDATED
```

Resultado pedagógico esperado:

```text
flujo crítico operativo
mitigación aplicada
evidencia disponible
riesgo declarado
acción preventiva definida
recursos limpiados
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

> **Hoy usamos AWS. El problema real no era AWS. Era sostener una promesa de negocio cuando tráfico, cambios y deuda técnica llegan todos juntos a producción.**

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
