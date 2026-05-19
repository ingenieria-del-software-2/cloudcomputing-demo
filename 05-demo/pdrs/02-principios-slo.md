# Consolidado V3 sobre V2 - 02-principios-slo

> Estado: V3 aplicado como base actual. El detalle de V2 queda preservado debajo para evitar perdida de contenido durante la mezcla.

## Base V3 actual

## 9. SLO de emergencia

### 9.1 SLO principal

Para evitar esperar demasiado durante la clase, el SLO de emergencia se define con ventana corta y medición simplificada.

```text
SLO: critical_order_journey_under_60s_ratio

Durante el ejercicio, al menos 95% de los pagos aprobados de prueba
deben llegar a un estado visible de tracking en menos de 60 segundos,
sin duplicar orden y sin marcar como disponible algo que no puede despacharse.
```

Este SLO es deliberadamente didáctico. No pretende ser un SLO realista de una empresa de escala masiva. Sirve para obligar a mirar el journey de punta a punta.

### 9.2 SLIs mínimos

V3 usa pocos SLIs para evitar el “big ball of SLOs”.

| SLI                                       | Uso en clase                             |
| ----------------------------------------- | ---------------------------------------- |
| `critical_order_journey_duration_seconds` | Mide pago aprobado → tracking visible.   |
| `buyer_tracking_freshness_seconds`        | Mide atraso de estado visible.           |
| `duplicate_order_attempts_total`          | Muestra retries/duplicados/idempotencia. |
| `shipment_document_failures_total`        | Detecta bloqueo de documentos/etiquetas. |
| `event_backlog_depth`                     | Muestra acumulación de trabajo.          |

### 9.3 Métricas distractoras

Para enseñar que no toda métrica es un síntoma de negocio, habrá al menos una métrica distractora simple y barata.

Opción V3 base:

```text
CPU alta en una instancia o container auxiliar.
```

La clase debe discutir:

> ¿CPU alta es el incidente o solo ruido si el SLO del journey está bien?

### 9.4 Observabilidad principal

El docente mantiene un stack externo o docente:

```text
Prometheus
Grafana
Alertmanager
```

Los servicios exponen `/metrics` y logs estructurados. Grafana muestra un tablero mínimo de war room.

No se fuerza CloudWatch como tablero principal porque la experiencia de exploración en vivo puede ser más lenta y menos clara para esta clase.

---


---

## Detalle V2 conservado

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

