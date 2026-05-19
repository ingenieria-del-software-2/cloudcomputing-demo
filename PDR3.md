# PDR v3 — CompraFiubi Black Friday SRE GameDay

**Versión:** 3.0
**Contexto:** clase/taller de Cloud Computing aplicada, FIUBA, quinto año Ingeniería en Informática
**Formato:** war room SRE + despliegue colaborativo en AWS con Terraform
**Duración objetivo:** aproximadamente 3 horas
**Audiencia:** alumnos avanzados, algunos con experiencia industrial
**Caso de uso:** marketplace ficticio estilo MercadoLibre, sin afirmar ni sugerir que esta sea arquitectura interna real de ninguna empresa
**Tono:** humorístico controlado, técnicamente serio
**Nombre de empresa ficticia:** `CompraFiubi`
**Evento:** Black Friday
**Restricción principal:** máximo 4 microservicios desplegables
**Arquitectura conceptual:** saga coreografiada, event-driven, database-per-service conceptual, AWS-first lab
**Enfoque pedagógico:** incidente-first / SRE-first, no AWS 101

---

## 1. Resumen ejecutivo

Esta clase deja de ser un recorrido lineal por servicios AWS y pasa a ser una experiencia de operación bajo presión.

Durante Black Friday, `CompraFiubi`, un marketplace ficticio, empieza la noche con el sistema ya degradado. La campaña acaba de arrancar, el tráfico sube, una feature comercial nueva fue activada, varios equipos tocaron infraestructura casi al mismo tiempo y los dashboards iniciales no cuentan una historia clara.

La clase entra como **war room SRE**. Los alumnos no vienen a “ver AWS”. Vienen a recuperar control sobre un flujo crítico de negocio:

```text
payment approved
→ order confirmed
→ fulfillment committed
→ shipment ready
→ buyer tracking updated
```

El sistema no está completamente caído. Peor: responde de forma parcial, se atrasa, a veces miente, y no queda claro qué métrica representa el dolor real del usuario.

La misión de la clase es restaurar una versión defendible del flujo Order-to-Ship, aplicando prácticas SRE: definir SLO de emergencia, separar síntomas de causas, leer evidencia, elegir mitigaciones, degradar features no críticas, corregir configuración, aplicar rollback o fix mínimo y cerrar con una nota de guardia.

El objetivo no es que los alumnos memoricen servicios AWS. El objetivo es que puedan defender decisiones como:

```text
¿Qué flujo salva el negocio?
¿Qué métrica representa dolor real del comprador?
¿Qué cambio revertimos primero?
¿Qué feature degradamos?
¿Cuándo escalar ayuda y cuándo solo hace más caro el problema?
¿Qué evidencia necesitamos para confiar en el sistema?
¿Qué guardrail evita depender de héroes la próxima vez?
```

---

## 2. Principio rector de la clase

La clase se organiza alrededor de una pregunta madre:

> **¿Qué estamos dispuestos a sacrificar para que la compra todavía sea confiable?**

Esta versión evita una frase demasiado genérica o “de IA”, y la vuelve más SRE:

```text
No buscamos que todo funcione.
Buscamos proteger la promesa crítica del sistema bajo presión.
```

La clase debe reforzar esta idea:

> Un sistema puede estar “up” y aun así estar rompiendo la promesa al usuario.

---

## 3. Cambio respecto de versiones anteriores

La versión anterior del PDR era arquitectura-first:

```text
Diseñamos Order-to-Ship
→ desplegamos servicios
→ probamos happy path
→ inyectamos incidentes
```

La versión 3 es incidente-first:

```text
Black Friday ya empezó
→ el sistema está degradado
→ definimos SLO de emergencia
→ desplegamos/activamos piezas heredadas
→ observamos síntomas
→ aplicamos curas SRE
→ cerramos con evidencia y postmortem liviano
```

La arquitectura sigue existiendo, pero ya no es “la solución bonita”. Es el escenario donde se ven las consecuencias de malas decisiones técnicas y organizacionales.

---

## 4. Supuestos cerrados para V3

Estas decisiones se toman para avanzar. Pueden cambiar en V4, pero V3 queda consistente con ellas.

| Decisión                     | V3 toma esta posición                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Empresa ficticia             | `CompraFiubi`                                                                               |
| Evento                       | Black Friday                                                                                |
| Tono                         | Humorístico controlado                                                                      |
| Inicio de la historia        | El sistema ya arranca degradado                                                             |
| Formato                      | War room SRE                                                                                |
| IA como tema                 | No es protagonista; el rediseño ya evita AWS 101                                            |
| Runtime                      | EC2 con Docker containers                                                                   |
| IaC                          | Terraform activo, no solo decorativo                                                        |
| Observabilidad               | Prometheus/Grafana/Alertmanager del docente como tablero principal                          |
| CloudWatch                   | No es tablero principal; opcional como soporte/log de AWS                                   |
| Microservicios               | 4 microservicios reales creados por el docente                                              |
| Lenguajes                    | NestJS/TypeScript y Go                                                                      |
| Cuentas AWS                  | Cada voluntario usa su propia cuenta                                                        |
| Integración entre cuentas    | V3 base evita cross-account IAM complejo                                                    |
| Comunicación entre servicios | HTTP entre servicios + SQS local por servicio/cuenta para simular asincronía y backpressure |
| Cross-account SQS            | Extensión avanzada, no base                                                                 |
| RDS                          | PostgreSQL real para servicios transaccionales, con cuidado de costo/cleanup                |
| DynamoDB                     | Real para buyer tracking                                                                    |
| S3                           | Real para documentos/etiquetas de despacho                                                  |
| Load balancer                | Fuera de scope base                                                                         |
| NAT Gateway                  | Fuera de scope base                                                                         |
| Route 53                     | Fuera de scope base                                                                         |
| ECR                          | Fuera de scope base si se usan imágenes públicas o prepublicadas                            |
| VPC                          | Default VPC, no eje pedagógico                                                              |
| Pausa                        | No hay pausa formal                                                                         |
| Evaluación                   | No hay evaluación formal                                                                    |
| Cierre                       | Nota de guardia / postmortem liviano                                                        |

---

## 5. Objetivo pedagógico

Que los alumnos entiendan Cloud Computing como práctica de arquitectura y operación bajo restricciones, usando AWS como plataforma concreta.

La clase debe llevarlos a discutir y experimentar:

```text
SLOs y SLIs centrados en usuario
war room / incident response
degradación controlada
rollback / fix mínimo
backpressure
colas y asincronía
idempotencia
IAM como causa real de incidente
observabilidad útil vs ruido
infraestructura como código
trade-offs de costo, seguridad, confiabilidad y operación
```

La clase no debe convertirse en:

```text
una explicación lineal de EC2/SQS/RDS/S3/DynamoDB/IAM
una demo donde los alumnos solo miran
un laboratorio perfecto donde nada falla
un curso de seguridad cloud
una clase de Kubernetes/ECS/EKS
una discusión abstracta sin AWS real
```

---

## 6. Marco SRE de la clase

La clase usa SRE como metodología práctica, no como teoría aislada.

| Momento narrativo                   | Herramienta SRE             |
| ----------------------------------- | --------------------------- |
| “No sabemos si estamos mal”         | SLI/SLO de emergencia       |
| “Todos miran métricas distintas”    | Métrica centrada en usuario |
| “Hay muchos cambios simultáneos”    | Timeline del incidente      |
| “La feature rompe el flujo crítico” | Graceful degradation        |
| “No sabemos qué revertir”           | Rollback discipline         |
| “El sistema no cae, se atrasa”      | Backpressure / queueing     |
| “Un mensaje llega dos veces”        | Idempotencia                |
| “Un permiso rompe shipment”         | Blast radius / fix mínimo   |
| “El comprador ve estado viejo”      | User-facing reliability     |
| “Se calmó el fuego”                 | Postmortem sin culpa        |

---

## 7. Storytelling base

### 7.1 Apertura

Son las 00:03 del Black Friday de `CompraFiubi`.

La campaña arrancó hace minutos. Producto venía empujando una feature llamada **Promesa Express**, que intenta mostrar al comprador una promesa logística más agresiva:

```text
“Comprá ahora y llega mañana”
```

La feature se activó justo antes del pico.

Al mismo tiempo:

```text
Infra tocó configuración de workers y concurrencia.
Seguridad ajustó permisos de despacho.
Observabilidad subió el nivel de logs y métricas.
Producto activó una promo agresiva.
Soporte empezó a recibir reclamos.
```

Los dashboards iniciales no muestran una caída total. Algunas cosas están verdes. Algunas compras pasan. Algunas se atrasan. Algunas quedan en estados raros.

La pregunta del war room no es “¿qué servicio AWS usamos?”.

La pregunta es:

```text
¿Qué está sufriendo el usuario y qué podemos sacrificar para recuperar control?
```

### 7.2 Personajes opcionales para mensajes durante la clase

Estos personajes no requieren alumnos dedicados. El docente puede disparar mensajes cortos en cada etapa.

```text
Producto:
“La Promesa Express mejora conversión, no la apaguen si no están seguros.”

Soporte:
“Tenemos compradores que pagaron y no ven el estado actualizado.”

Infra:
“Los cambios eran chicos. Ninguno debería romper nada solo.”

Seguridad:
“Se ajustaron permisos para reducir superficie. No debería impactar negocio.”

SRE:
“Paren. Primero definamos qué significa estar mal.”
```

---

## 8. Flujo crítico

El flujo crítico se mantiene como Order-to-Ship:

```text
payment approved
→ order confirmed
→ fulfillment committed
→ shipment ready
→ buyer tracking updated
```

### 8.1 Interpretación de negocio

| Paso                     | Significado                                                          |
| ------------------------ | -------------------------------------------------------------------- |
| `payment approved`       | El comprador pagó; ahora el sistema le debe una respuesta confiable. |
| `order confirmed`        | Existe una orden comercial consistente.                              |
| `fulfillment committed`  | El sistema cree que puede cumplir lo vendido.                        |
| `shipment ready`         | Hay un despacho listo, o al menos un estado operativo honesto.       |
| `buyer tracking updated` | El comprador ve una verdad suficientemente fresca y no engañosa.     |

### 8.2 Qué significa salvar el negocio

Para esta clase, salvar el negocio no significa que todo el marketplace funcione. Significa:

```text
1. El comprador puede iniciar una compra.
2. El pago aprobado no genera caos comercial.
3. La orden no se duplica.
4. El sistema no promete stock o despacho de forma irresponsable.
5. El tracking visible no queda mintiendo durante demasiado tiempo.
```

### 8.3 Qué podemos sacrificar

Durante el incidente, se pueden sacrificar temporalmente:

```text
Promesa Express
precisión fina de la promesa logística
personalización
detalle de tracking no crítico
velocidad de features nuevas
nivel de logs demasiado verboso
procesamiento de eventos no críticos
```

No se debería sacrificar:

```text
idempotencia de pagos
consistencia mínima de stock/reserva
honestidad del estado visible
capacidad de reconstruir una orden
cleanup de recursos AWS
```

---

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

## 10. Microservicios

V3 conserva 4 microservicios reales.

| # | Microservicio          | Responsabilidad narrativa                          | Dueño en clase |
| - | ---------------------- | -------------------------------------------------- | -------------- |
| 1 | `order-management`     | Evitar que un pago aprobado genere caos comercial. | Voluntario 1   |
| 2 | `fulfillment-planning` | Decidir si se puede cumplir lo vendido.            | Voluntario 2   |
| 3 | `shipment-preparation` | Convertir commitment en algo despachable.          | Voluntario 2   |
| 4 | `buyer-order-tracking` | Mostrar una verdad fresca y honesta al comprador.  | Voluntario 3   |

### 10.1 Por qué 4 servicios aunque hay 3 voluntarios

Se mantienen 4 servicios porque permiten mostrar más capacidades cloud sin volver la clase inmanejable:

```text
order-management       → RDS, idempotencia, entrada de pagos
fulfillment-planning   → RDS, backlog, Promesa Express, stock
shipment-preparation   → S3, IAM, documentos
buyer-order-tracking   → DynamoDB, read model, freshness, experiencia visible
```

El voluntario 2 opera dos servicios porque `fulfillment` y `shipment` están naturalmente conectados en la historia y pueden desplegarse juntos.

---

## 11. Roles de la clase

### 11.1 Docente

El docente actúa como:

```text
Incident Commander
SRE principal
facilitador de decisiones
narrador del incidente
controlador del tiempo
```

No delega la conducción del incidente porque la clase no tiene preparación previa y hay que evitar caos.

### 11.2 Voluntario 1 — Checkout / Order Team

Responsabilidad:

```text
Desplegar y operar order-management.
Simular pagos aprobados.
Verificar idempotencia.
Publicar eventos de orden confirmada.
Mostrar evidencia de orden creada.
```

Problemas que resuelve:

```text
payment_id duplicado
orden creada tarde
evento incompleto
falta de correlation_id
entrada de tráfico de prueba
```

### 11.3 Voluntario 2 — Fulfillment / Shipping Team

Responsabilidad:

```text
Desplegar y operar fulfillment-planning y shipment-preparation.
Reservar stock.
Activar/desactivar Promesa Express.
Generar shipment.
Guardar documento/etiqueta en S3.
Resolver fallo IAM de documentos.
```

Problemas que resuelve:

```text
latencia artificial por Promesa Express
backlog por worker/concurrency baja
stock insuficiente o reserva duplicada
s3:PutObject faltante
shipment bloqueado
```

### 11.4 Voluntario 3 — Buyer Experience / Tracking Team

Responsabilidad:

```text
Desplegar y operar buyer-order-tracking.
Exponer endpoint de tracking.
Mostrar freshness.
Ayudar a reconstruir timeline con correlation_id.
```

Problemas que resuelve:

```text
tracking stale
read model desactualizado
eventos fuera de orden
falta de evidencia visible para comprador
```

### 11.5 Resto de la clase

El resto de la clase actúa como war room ampliada:

```text
vota hipótesis
critica decisiones
propone mitigaciones
elige qué sacrificar
ayuda a construir timeline
identifica métricas útiles vs ruido
participa en nota de guardia
```

---

## 12. Arquitectura lógica

### 12.1 Vista conceptual

```text
payments-core mock
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

Pero `buyer-order-tracking` puede recibir eventos de varios pasos para construir timeline:

```text
buyer-order-tracking consume eventos de:
- order-management
- fulfillment-planning
- shipment-preparation
```

### 12.2 Modo de integración V3 base

Para evitar que cross-account IAM consuma la clase, V3 base usa este patrón:

```text
Servicio A publica evento por HTTP al endpoint interno de Servicio B.
Servicio B ingresa ese evento en su SQS local.
Servicio B procesa desde su propia cola.
```

Ejemplo:

```text
order-management
  POST http://FULFILLMENT_HOST/internal/events
      → fulfillment-planning local SQS
      → fulfillment worker
```

Esto no es la forma más pura de event-driven cross-account, pero permite:

```text
colaboración real entre cuentas
servicios reales desplegados por alumnos
SQS real para backlog y retries locales
menor fricción IAM cross-account
más tiempo para SRE y arquitectura
```

### 12.3 Extensión avanzada

Una versión futura puede reemplazar HTTP event forwarding por:

```text
SQS cross-account con resource policies
EventBridge cross-account
SNS fanout
```

Pero eso queda fuera del camino crítico de V3.

---

## 13. Arquitectura AWS V3

### 13.1 Servicios AWS usados

| Necesidad                      | Servicio / herramienta        |
| ------------------------------ | ----------------------------- |
| Correr microservicios clásicos | EC2 + Docker                  |
| Comunicación y backlog local   | SQS                           |
| Estado transaccional           | RDS PostgreSQL                |
| Documentos de despacho         | S3                            |
| Tracking buyer-facing          | DynamoDB                      |
| Permisos de aplicación         | IAM Roles / Instance Profiles |
| Red básica                     | Default VPC + Security Groups |
| IaC                            | Terraform                     |
| Métricas operativas            | Prometheus/Grafana docente    |
| Alertas del taller             | Alertmanager docente          |

### 13.2 Servicios evitados en V3 base

```text
NAT Gateway
Load Balancer
Route 53
ECS/EKS
Lambda
EventBridge
CloudFront
WAF
Multi-region
Multi-AZ obligatorio
ECR obligatorio
AWS Budgets como parte del flujo
```

No se descartan por irrelevantes, sino por foco y tiempo.

---

## 14. Despliegue por cuenta

Cada voluntario usa su propia cuenta AWS.

### 14.1 Distribución recomendada

| Cuenta               | Dueño        | Recursos principales                                                                         |
| -------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| Cuenta A             | Voluntario 1 | EC2 order-management, RDS order DB, SQS local, IAM role, SG                                  |
| Cuenta B             | Voluntario 2 | EC2 fulfillment/shipment, RDS fulfillment/shipment, S3 documentos, SQS locales, IAM role, SG |
| Cuenta C             | Voluntario 3 | EC2 buyer-tracking, DynamoDB, SQS local, IAM role, SG                                        |
| Cuenta/stack docente | Docente      | Prometheus, Grafana, Alertmanager, fallback opcional                                         |

### 14.2 EC2 count recomendado

V3 recomienda:

```text
1 EC2 por voluntario
```

Cada EC2 corre uno o más containers Docker.

Motivo:

```text
reduce costo
reduce tiempo de provisioning
mantiene ownership por cuenta
permite operar servicios reales
suficiente para una clase de 3 horas
```

### 14.3 RDS

Para el ideal conceptual:

```text
order-management       → PostgreSQL propio
fulfillment-planning   → PostgreSQL propio
shipment-preparation   → PostgreSQL propio
buyer-order-tracking   → DynamoDB
```

Para V3 operativa:

```text
Cuenta A: 1 RDS PostgreSQL para order-management
Cuenta B: 1 RDS PostgreSQL con DB/schema separados para fulfillment y shipment
Cuenta C: DynamoDB para tracking
```

Se aclara explícitamente:

> Conceptualmente es database-per-service. Operativamente, para costo y tiempo, fulfillment y shipment pueden compartir instancia RDS con bases/schemas separados.

---

## 15. Packaging y deploy de aplicaciones

### 15.1 Decisión V3

Los servicios ya están creados por el docente y se despliegan como containers Docker.

V3 evita ECR obligatorio para reducir setup.

Opciones aceptadas:

```text
1. Imágenes públicas en GHCR/Docker Hub.
2. Imágenes preconstruidas y disponibles antes de clase.
3. Fallback: docker compose con build local si el registry falla.
```

### 15.2 Terraform

Terraform debe crear:

```text
EC2
Security Groups
IAM roles / instance profiles
RDS
SQS
S3
DynamoDB
user_data o archivos de configuración inicial
outputs con endpoints
```

Terraform no debe ser una caja negra total. La clase debe ver al menos:

```text
terraform plan
terraform apply
terraform output
terraform destroy
```

### 15.3 Configuración de fallas

Las fallas se activan por variables de entorno o configuración generada por Terraform.

Ejemplos:

```text
PROMESA_EXPRESS_ENABLED=true
PROMESA_EXPRESS_LATENCY_MS=1500
PROMESA_EXPRESS_ERROR_RATE=0.20
IDEMPOTENCY_ENABLED=false
WORKER_CONCURRENCY=1
TRACKING_CONSUMER_DELAY_MS=3000
SHIPMENT_S3_PERMISSION_MODE=broken
LOG_LEVEL=debug
```

La cura puede aplicarse por:

```text
cambio de variable/env
nuevo terraform apply
restart de container
fix de IAM policy
script de configuración
```

---

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

## 18. Microservicio 1 — order-management

### Responsabilidad

Confirmar y administrar la orden comercial a partir de un pago aprobado.

### Consume

```text
payments.payment_approved.v1
```

En V3, `payments-core` es mockeado por endpoint/script.

### Produce

```text
orders.order_confirmed.v1
orders.duplicate_payment_ignored.v1
orders.order_confirmation_failed.v1
```

### Persistencia

```text
RDS PostgreSQL
```

### API mínima

```http
POST /internal/payments/approved
GET  /orders/{order_id}
GET  /health
GET  /metrics
```

### Falla inicial posible

```text
IDEMPOTENCY_ENABLED=false
```

Con carga/retries, el mismo payment_id puede intentar crear más de una orden.

### Cura

```text
IDEMPOTENCY_ENABLED=true
unique constraint sobre payment_id
manejo explícito de duplicate payment
```

### Evidencia

```text
orden creada
payment duplicado ignorado
log con correlation_id
metric duplicate_order_attempts_total
```

---

## 19. Microservicio 2 — fulfillment-planning

### Responsabilidad

Reservar stock, decidir si se puede cumplir la orden y generar commitment de fulfillment.

### Consume

```text
orders.order_confirmed.v1
```

### Produce

```text
fulfillment.commitment_confirmed.v1
fulfillment.commitment_failed.v1
fulfillment.commitment_at_risk.v1
```

### Persistencia

```text
RDS PostgreSQL
```

### API mínima

```http
POST /internal/events
GET  /fulfillment/orders/{order_id}
GET  /inventory/{seller_sku}
GET  /health
GET  /metrics
```

### Falla inicial principal

```text
PROMESA_EXPRESS_ENABLED=true
PROMESA_EXPRESS_LATENCY_MS alto
PROMESA_EXPRESS_ERROR_RATE > 0
WORKER_CONCURRENCY=1
```

La feature comercial agrega latencia y errores en el camino de fulfillment.

### Cura

```text
PROMESA_EXPRESS_ENABLED=false
fallback a promesa estándar
WORKER_CONCURRENCY ajustada si corresponde
```

### Evidencia

```text
backlog baja
fulfillment_commitment_latency mejora
tracking se actualiza más rápido
SLO del journey mejora
```

---

## 20. Microservicio 3 — shipment-preparation

### Responsabilidad

Crear shipment, generar documento/etiqueta e indicar que la orden está lista para despacho.

### Consume

```text
fulfillment.commitment_confirmed.v1
```

### Produce

```text
shipping.shipment_ready_to_dispatch.v1
shipping.dispatch_blocked.v1
```

### Persistencia

```text
RDS PostgreSQL para metadata
S3 para documentos/etiquetas
```

### API mínima

```http
POST /internal/events
GET  /shipments/{shipment_id}
GET  /shipments/{shipment_id}/documents
GET  /health
GET  /metrics
```

### Falla inicial principal

```text
IAM role sin permiso s3:PutObject sobre el bucket de documentos
```

### Cura

```text
fix mínimo de IAM policy
reintento controlado de generación de documento
estado visible honesto si sigue bloqueado
```

### Evidencia

```text
AccessDenied antes del fix
shipment_document_failures_total aumenta
objeto aparece en S3 después del fix
shipping.shipment_ready_to_dispatch.v1 emitido
```

---

## 21. Microservicio 4 — buyer-order-tracking

### Responsabilidad

Mantener una vista visible para el comprador, con freshness razonable y timeline comprensible.

### Consume

```text
orders.order_confirmed.v1
fulfillment.commitment_confirmed.v1
fulfillment.commitment_failed.v1
shipping.shipment_ready_to_dispatch.v1
shipping.dispatch_blocked.v1
```

### Produce

```text
customer_experience.order_tracking_updated.v1
```

### Persistencia

```text
DynamoDB
```

### API mínima

```http
POST /internal/events
GET  /orders/{order_id}/tracking
GET  /buyers/{buyer_id}/orders
GET  /health
GET  /metrics
```

### Falla inicial posible

```text
TRACKING_CONSUMER_DELAY_MS alto
TRACKING_CONSUMER_ENABLED=true pero lento
```

La saga puede avanzar, pero el comprador ve estado viejo.

### Cura

```text
reducir delay
priorizar eventos buyer-facing
mostrar estados honestos: FULFILLMENT_AT_RISK, DISPATCH_BLOCKED, etc.
```

### Evidencia

```text
buyer_tracking_freshness_seconds mejora
tracking final visible
timeline reconstruible por correlation_id
```

---

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

## 24. Stages de la clase

V3 propone 7 stages sin pausa formal.

### Stage 0 — Briefing: “Black Friday ya empezó”

**Duración:** 10–15 min

#### Storytelling

CompraFiubi está en Black Friday. El sistema está degradado, no caído.

#### Done

```text
[ ] La clase entiende el flujo crítico.
[ ] Se presentan roles de voluntarios.
[ ] Se presentan síntomas iniciales.
[ ] Se explicita que AWS es el medio, no el tema central.
```

#### Pregunta

> ¿Qué promesa mínima debe seguir cumpliendo el sistema?

---

### Stage 1 — SLO de emergencia

**Duración:** 15 min

#### Actividad

El docente propone varias métricas candidatas:

```text
CPU alta
cantidad de logs
queue depth
tracking freshness
journey duration
órdenes confirmadas
```

La clase discute cuál representa dolor real.

#### Done

```text
[ ] Se acepta el SLO critical_order_journey_under_60s_ratio.
[ ] Se declara que CPU/logs son drill-down, no norte principal.
[ ] Se establece severidad didáctica del incidente.
```

#### Pregunta

> ¿CPU alta es un incidente si el comprador todavía puede comprar y ver tracking?

---

### Stage 2 — Deploy heredado/degradado

**Duración:** 30–35 min

#### Actividad

Los 3 voluntarios ejecutan Terraform en sus cuentas.

```text
Vol 1: order-management
Vol 2: fulfillment + shipment
Vol 3: buyer-tracking
```

#### Done

```text
[ ] terraform apply completado o fallback activado.
[ ] endpoints disponibles.
[ ] /health responde.
[ ] /metrics visible para Prometheus/Grafana.
[ ] outputs compartidos entre equipos.
```

#### Pregunta

> ¿Qué contrato depende de otro equipo?

---

### Stage 3 — Happy path sospechoso

**Duración:** 20 min

#### Actividad

Se simula una compra controlada.

```text
payment approved
→ order confirmed
→ fulfillment committed
→ shipment ready
→ tracking updated
```

#### Done

```text
[ ] Se ve una orden creada.
[ ] Se ve tracking visible.
[ ] Se ve correlation_id.
[ ] Se detecta que un caso exitoso no prueba confiabilidad.
```

#### Pregunta

> ¿Un caso exitoso prueba que estamos listos para Black Friday?

---

### Stage 4 — Incidente Promesa Express

**Duración:** 30 min

#### Actividad

Se ejecuta carga moderada. Promesa Express introduce latencia/error. El SLO cae.

#### Done

```text
[ ] Se observa degradación del SLO.
[ ] Se identifica Promesa Express como feature no crítica.
[ ] La clase decide degradarla/apagarla.
[ ] Se aplica cambio de config.
[ ] Se observa mejora.
```

#### Cura SRE

```text
graceful degradation
feature flag
proteger flujo crítico
```

#### Pregunta

> ¿Qué duele más esta noche: perder Promesa Express o perder checkout confiable?

---

### Stage 5 — Incidente IAM / shipment bloqueado

**Duración:** 25 min

#### Actividad

Shipment no puede guardar documento en S3 por permiso faltante.

#### Done

```text
[ ] Se observa error de permisos.
[ ] Se conecta el error con impacto de negocio.
[ ] Se aplica fix mínimo de IAM.
[ ] Se genera documento.
[ ] Tracking refleja estado correcto.
```

#### Cura SRE

```text
mitigación controlada
blast radius
fix mínimo
rollback discipline
```

#### Pregunta

> ¿Cuál es el permiso mínimo que recupera el flujo sin abrir demasiado el sistema?

---

### Stage 6 — Tracking stale y verdad visible

**Duración:** 25 min

#### Actividad

Internamente la saga avanza, pero el comprador ve estado viejo.

#### Done

```text
[ ] Se mide buyer_tracking_freshness_seconds.
[ ] Se reconstruye timeline con correlation_id.
[ ] Se actualiza tracking.
[ ] La clase discute estado visible honesto vs bonito.
```

#### Cura SRE

```text
user-facing reliability
freshness SLI
correlation_id
```

#### Pregunta

> ¿El sistema está sano si la verdad interna y la verdad visible no coinciden?

---

### Stage 7 — Nota de guardia y cleanup

**Duración:** 20 min

#### Actividad

La clase produce una nota de guardia breve y se ejecuta/explica cleanup.

#### Done

```text
[ ] Impacto escrito.
[ ] SLO afectado escrito.
[ ] Cambios contribuyentes listados.
[ ] Mitigación aplicada documentada.
[ ] Riesgo aceptado declarado.
[ ] Acción preventiva definida.
[ ] Cleanup ejecutado o comandado.
```

#### Pregunta

> ¿Qué guardrail evita depender de héroes la próxima vez?

---

## 25. Tablero de war room

El dashboard principal de Grafana debe tener pocos paneles.

### 25.1 Paneles principales

```text
critical_order_journey_duration_seconds p95
critical_order_journey_under_60s_ratio
buyer_tracking_freshness_seconds p95
event_backlog_depth por servicio
shipment_document_failures_total
duplicate_order_attempts_total
```

### 25.2 Paneles secundarios / drill-down

```text
CPU por instancia/container
requests por servicio
error rate por servicio
worker processing duration
SQS local queue depth
RDS basic health si se expone
```

### 25.3 Regla didáctica

El tablero debe reforzar:

```text
Primero usuario/journey.
Después recurso.
```

---

## 26. Logs y evidencia

Aunque Prometheus/Grafana sea el tablero principal, cada servicio debe loggear de forma estructurada.

Campos mínimos:

```text
service_name
event_name
correlation_id
order_id
payment_id si aplica
shipment_id si aplica
status_before
status_after
business_error_code
duration_ms
result
```

Ejemplo:

```json
{
  "service": "fulfillment-planning",
  "correlation_id": "checkout_01HX9M6R3W",
  "event_name": "orders.order_confirmed.v1",
  "order_id": "ord_2000007712345678",
  "result": "FULFILLMENT_COMMITTED",
  "duration_ms": 1842,
  "feature_promesa_express": true
}
```

Loki es opcional. Si no está listo, alcanza con:

```text
docker logs
endpoint de timeline
logs locales visibles por voluntario
capturas fallback
```

---

## 27. Seguridad e IAM

La seguridad no domina la clase, pero aparece como problema real.

Principios V3:

```text
No access keys hardcodeadas.
EC2 usa IAM Role / Instance Profile.
Permisos por responsabilidad.
IAM puede romper producción tanto como el código.
```

Incidente principal:

```text
shipment-preparation no puede hacer s3:PutObject.
```

La clase discute:

```text
permiso mínimo
permiso temporal amplio
blast radius
rollback
riesgo aceptado
```

No se profundiza en CloudTrail, SCPs, Organizations ni compliance.

---

## 28. Red

V3 usa default VPC para no convertir la clase en networking lab.

Reglas base:

```text
EC2 públicas con Security Groups mínimos necesarios.
Endpoints HTTP expuestos para integración entre cuentas.
Prometheus docente puede scrapear /metrics.
RDS accesible solo desde la EC2 correspondiente cuando sea viable.
```

No se incluye:

```text
VPC peering
PrivateLink
Transit Gateway
VPC sharing
subnets privadas estrictas
NAT Gateway
```

Nota pedagógica:

> Esta simplificación es consciente. El foco no es diseñar red perfecta, sino operar un flujo cloud bajo presión.

---

## 29. Datos de prueba

### 29.1 Payload de pago aprobado

```json
{
  "payment_id": "pay_8800192331",
  "cart_id": "cart_bf_001",
  "buyer_id": "buyer_918273",
  "seller_id": "seller_445566",
  "site_id": "MLA",
  "currency": "ARS",
  "gross_amount": 52999.99,
  "items": [
    {
      "item_id": "CFB123456",
      "seller_sku": "MATE-STANLEY-NO-OFICIAL",
      "quantity": 1,
      "unit_price": 52999.99
    }
  ]
}
```

Se usa humor controlado en SKUs, sin romper seriedad técnica.

### 29.2 Stock inicial sugerido

```text
MATE-STANLEY-NO-OFICIAL: stock bajo
CARPINCHO-USB-C: stock normal
TECLADO-MECANICO-RUIDOSO: stock normal
```

---

## 30. Participación del resto de la clase

El resto de la clase participa en cada stage con decisiones rápidas.

Mecánica sugerida:

```text
1. Se muestra síntoma.
2. El aula propone hipótesis.
3. Se vota una acción.
4. El voluntario aplica cambio.
5. Se observa evidencia.
6. Se extrae principio SRE/cloud.
```

Preguntas recurrentes:

```text
¿Qué métrica manda?
¿Qué sacrificamos?
¿Qué cambio revertimos primero?
¿Qué evidencia necesitamos?
¿Esto arregla o solo oculta?
¿Qué riesgo aceptamos?
```

---

## 31. Criterios de éxito de la experiencia

La clase fue exitosa si los alumnos pueden explicar:

```text
1. Por qué el flujo crítico no termina en “orden creada”.
2. Por qué una compra pagada puede seguir siendo un incidente.
3. Qué SLO representa dolor real del comprador.
4. Por qué CPU alta puede ser ruido.
5. Por qué un sistema puede estar up y aun así estar mal.
6. Por qué Promesa Express se puede degradar sin destruir el negocio.
7. Por qué idempotencia importa durante Black Friday.
8. Por qué IAM puede bloquear un flujo de negocio.
9. Por qué tracking viejo es un problema de confiabilidad.
10. Cómo Terraform ayuda a auditar y corregir cambios.
11. Qué guardrail habría evitado repetir el incidente.
```

---

## 32. Nota de guardia final

Template:

```text
Incidente:
Black Friday / Order-to-Ship degradado en CompraFiubi

Impacto:

SLO afectado:

Síntoma principal:

Cambios contribuyentes:

Mitigaciones aplicadas:

Riesgo aceptado:

Qué sacrificamos:

Qué no volveríamos a hacer:

Acción preventiva:
```

Ejemplo esperado:

```text
Incidente:
Black Friday / Order-to-Ship degradado en CompraFiubi

Impacto:
Compradores con pago aprobado veían tracking atrasado.
Algunos shipments quedaban bloqueados por falta de documentos.

SLO afectado:
critical_order_journey_under_60s_ratio

Síntoma principal:
Backlog en fulfillment y tracking stale.

Cambios contribuyentes:
Promesa Express activada con latencia.
Worker concurrency baja.
Permiso S3 incompleto para shipment-preparation.

Mitigaciones aplicadas:
Desactivar Promesa Express.
Corregir permiso s3:PutObject mínimo.
Priorizar eventos buyer-facing.

Riesgo aceptado:
Promesa logística menos precisa durante ventana crítica.

Qué sacrificamos:
Promesa Express y detalle fino de entrega.

Acción preventiva:
Freeze de cambios antes de eventos críticos.
Feature flags obligatorios.
SLO de journey antes de launch.
Runbook de rollback.
```

---

## 33. Cleanup

Cleanup es parte del state of done.

Checklist final:

```text
[ ] terraform destroy ejecutado o programado
[ ] EC2 terminadas
[ ] RDS eliminado si aplica
[ ] snapshots no deseados revisados
[ ] buckets S3 vacíos/eliminados
[ ] colas SQS eliminadas
[ ] tablas DynamoDB eliminadas
[ ] security groups no usados eliminados
[ ] no Elastic IPs huérfanas
[ ] no Load Balancers creados
```

Nota:

> Si algo no se puede destruir en vivo por tiempo, debe quedar comando exacto y responsable claro.

---

## 34. Fallbacks

### Si Terraform falla

```text
Usar cuenta docente fallback.
Mostrar terraform plan esperado.
Pasar a modo tabletop del stage.
```

### Si RDS tarda o falla

```text
Usar DB local/containerizada como fallback.
Mantener discusión conceptual de RDS.
```

### Si Prometheus/Grafana no scrapea

```text
Usar endpoints /metrics manuales.
Usar capturas precargadas.
Usar logs stdout.
```

### Si falla integración entre cuentas

```text
Usar eventos manuales por curl.
Usar payloads prearmados.
Simular downstream con endpoint local.
```

### Si falla S3/IAM demasiado pronto

```text
Convertirlo en incidente narrativo.
Usar documento mock.
Mostrar policy esperada.
```

### Si el tiempo se corta

Prioridad de stages:

```text
Obligatorios:
1. Briefing
2. SLO de emergencia
3. Deploy mínimo o fallback
4. Promesa Express
5. Nota de guardia

Recortables:
- tracking stale separado
- payment duplicado
- CPU distractora
```

---

## 35. Plan de clase V3, alto nivel

```text
00:00–00:15  Stage 0 — Briefing Black Friday
00:15–00:30  Stage 1 — SLO de emergencia
00:30–01:05  Stage 2 — Deploy heredado/degradado
01:05–01:25  Stage 3 — Happy path sospechoso
01:25–01:55  Stage 4 — Promesa Express degrada fulfillment
01:55–02:20  Stage 5 — IAM bloquea shipment documents
02:20–02:45  Stage 6 — Tracking stale / verdad visible
02:45–03:00  Stage 7 — Nota de guardia + cleanup
```

No hay pausa formal en V3, pero el ritmo debe alternar:

```text
demo breve
discusión breve
decisión
aplicar cambio
evidencia
```

---

## 36. ADRs V3

### ADR-001 — SRE-first GameDay

**Decisión:** la clase se estructura como incidente SRE, no como despliegue lineal.

**Motivo:** alumnos avanzados, evitar AWS 101, conectar arquitectura con operación.

**Tradeoff:** menos tiempo para explicar cada servicio individualmente.

---

### ADR-002 — Order-to-Ship como flujo crítico

**Decisión:** mantener Order-to-Ship como journey principal.

**Motivo:** combina orden, fulfillment, shipment, tracking, asincronía, estado y operación.

**Tradeoff:** es más complejo que un simple checkout.

---

### ADR-003 — 4 microservicios reales

**Decisión:** mantener 4 microservicios.

**Motivo:** permite mostrar responsabilidades diferenciadas y servicios AWS variados.

**Tradeoff:** un voluntario opera dos servicios.

---

### ADR-004 — EC2 + Docker como runtime

**Decisión:** usar EC2 con containers Docker.

**Motivo:** enfoque cloud clásico, visible, razonable para enseñar VMs, roles, SGs y deploy.

**Tradeoff:** más setup que serverless.

---

### ADR-005 — Prometheus/Grafana como observabilidad principal

**Decisión:** usar stack docente de observabilidad en vez de CloudWatch como tablero principal.

**Motivo:** experiencia más clara en vivo para SLOs, alertas y war room.

**Tradeoff:** requiere operar stack docente externo.

---

### ADR-006 — No cross-account SQS en V3 base

**Decisión:** evitar cross-account IAM/SQS en la versión base.

**Motivo:** reduce riesgo logístico y deja más tiempo a SRE/arquitectura.

**Tradeoff:** el event-driven cross-account no es puro.

---

### ADR-007 — SQS local por servicio/cuenta

**Decisión:** usar SQS local como buffer/backlog interno de cada servicio.

**Motivo:** permite enseñar colas, retries, backlog e idempotencia sin integración cross-account compleja.

**Tradeoff:** la publicación entre servicios usa HTTP forwarding en V3.

---

### ADR-008 — SLO de journey corto

**Decisión:** usar 60 segundos como ventana didáctica del journey.

**Motivo:** evita esperar demasiado en clase y permite feedback rápido.

**Tradeoff:** no representa necesariamente un SLO realista.

---

### ADR-009 — Feature degradable

**Decisión:** Promesa Express puede apagarse o degradarse.

**Motivo:** enseña graceful degradation y priorización de flujo crítico.

**Tradeoff:** se sacrifica experiencia/producto temporalmente.

---

### ADR-010 — IAM como incidente, no como clase completa

**Decisión:** incluir una falla IAM concreta en shipment-preparation.

**Motivo:** muestra que seguridad/configuración impacta negocio.

**Tradeoff:** no se profundiza en seguridad avanzada.

---

## 37. Decisiones de implementación cerradas para V3.1

Estas decisiones se cierran a partir de las respuestas del docente y pasan a orientar la implementación técnica.

### 37.1 Observabilidad docente

El docente tendrá un stack público accesible desde las cuentas de los voluntarios:

```text
Prometheus
Grafana
Alertmanager
Loki
```

Los servicios deberán exponer métricas Prometheus por HTTP, idealmente en:

```text
GET /metrics
```

Los logs podrán ir por dos caminos:

```text
stdout del container como fallback mínimo
Loki como agregación opcional/principal si está operativo
```

Decisión:

> Grafana/Prometheus/Loki serán el tablero de war room. AWS CloudWatch no será la interfaz principal de observabilidad de la clase.

---

### 37.2 Red y exposición

Para V3.1 se asume una red simple y pública.

```text
EC2 públicas
endpoints HTTP públicos
/metrics público o protegido solo por security group/IP allowlist simple
RDS accesible desde la EC2 correspondiente
servicios integrados por HTTP entre cuentas
```

Esto es una simplificación consciente para una clase de 3 horas.

Tradeoff:

```text
+ reduce fricción de networking
+ permite integración entre cuentas sin cross-account IAM complejo
- no representa un diseño de red production-grade
- requiere cuidado con datos ficticios y cleanup
```

Nota pedagógica:

> La simplificación de red no debe venderse como buena práctica productiva. Se usa para que la clase pueda concentrarse en SRE, arquitectura y trade-offs.

---

### 37.3 Imágenes Docker

Como no habrá cambios de código durante la clase, no hace falta rebuild de imágenes en vivo.

Decisión V3.1:

```text
usar imágenes Docker preconstruidas
publicadas antes de la clase
preferentemente en GHCR o Docker Hub
```

ECR queda fuera del camino crítico.

Motivo:

```text
reduce setup
reduce permisos AWS necesarios
evita enseñar registry/deploy pipeline cuando no es el foco
```

Fallback:

```text
si falla el registry, usar imagen ya presente en la EC2 o build local predefinido
```

---

### 37.4 RDS

RDS PostgreSQL se mantiene como servicio real en V3.1.

Decisión:

```text
order-management usa RDS PostgreSQL
fulfillment-planning y shipment-preparation usan RDS PostgreSQL
buyer-order-tracking usa DynamoDB
```

Para reducir costo y tiempo, fulfillment y shipment pueden compartir una misma instancia RDS con bases o schemas separados.

---

### 37.5 UI

No se prioriza una UI completa.

Decisión:

```text
endpoints JSON son suficientes para la clase
```

Endpoint principal visible:

```http
GET /orders/{order_id}/tracking
```

Una mini UI puede existir como bonus, pero no debe ser dependencia del taller.

---

### 37.6 Generación de carga

El docente dispara la simulación de Black Friday.

Decisión:

```text
la carga no la disparan los voluntarios
el docente controla volumen, duplicados y ritmo
```

Simulación sugerida para V3.1:

```text
happy path: 1 orden
burst pequeño: 20 órdenes
burst moderado: 50 órdenes
porcentaje duplicados: 10–15%
concurrencia inicial: 5 requests paralelos
concurrencia máxima recomendada: 10 requests paralelos
```

Esto debería alcanzar para mostrar:

```text
latencia
backlog
tracking freshness
duplicados
mejora tras mitigación
```

sin generar costos relevantes ni convertir la clase en prueba de performance real.

---

### 37.7 Cambios de configuración / curas

La mayoría de las curas se aplican por cambios de environment variables y restart de container.

Decisión V3.1:

```text
no usar Terraform para cada cambio de comportamiento de aplicación
usar Terraform para infraestructura
usar env/config + restart para curas de runtime
```

Ejemplos:

```text
PROMESA_EXPRESS_ENABLED=false
PROMESA_EXPRESS_LATENCY_MS=0
PROMESA_EXPRESS_ERROR_RATE=0
TRACKING_CONSUMER_DELAY_MS=0
WORKER_CONCURRENCY=3
LOG_LEVEL=info
```

Mecanismo recomendado:

```text
.env por servicio
Docker Compose por EC2
make targets simples
```

Ejemplo conceptual:

```bash
make disable-promesa-express
make restart-fulfillment
```

Por debajo, puede hacer:

```bash
sed -i 's/PROMESA_EXPRESS_ENABLED=true/PROMESA_EXPRESS_ENABLED=false/' .env.fulfillment
docker compose up -d --force-recreate fulfillment-planning
```

Para fallas de infraestructura, como IAM/S3, sí se usa Terraform:

```text
terraform plan
terraform apply
```

---

### 37.8 Evidencia precapturada

V3.1 debe incluir fallback visual mínimo por stage.

Evidencias recomendadas:

```text
captura de Grafana con SLO degradado
captura de Grafana con SLO recuperado
log de Promesa Express generando latencia
log de AccessDenied en shipment-preparation
captura/listado de objeto creado en S3 tras fix
respuesta JSON de tracking stale
respuesta JSON de tracking corregido
terraform plan del fix IAM
payloads de prueba
nota de guardia ejemplo
```

Estas evidencias no reemplazan la demo, pero evitan que la clase dependa de que todo funcione perfecto.

---

### 37.9 Grabación async

La versión async será la grabación de la clase en vivo.

Recomendación:

```text
hacer preguntas explícitas antes de revelar cada mitigación
pausar verbalmente 10–15 segundos para que quien vea grabado pueda pensar
nombrar cada stage de forma clara
```

---

## 38. Decisiones de implementación cerradas para V3.2

Estas decisiones cierran los pendientes de V3.1 y bajan el diseño a un nivel suficientemente concreto para pasar luego a módulos Terraform, Compose files y runbooks.

### 38.1 Container registry

Decisión V3.2:

```text
Registry base: GHCR
Imágenes: preconstruidas
Rebuild en clase: no
ECR: fuera del camino crítico
```

Opción recomendada para simplificar:

```text
imágenes públicas en GHCR
pull anónimo desde EC2
```

Aclaración importante:

> El IAM Role de EC2 no autentica directamente contra GHCR. El IAM Role sirve para permisos AWS. Si las imágenes de GHCR son privadas, la EC2 necesitará un token de GitHub para hacer docker login.

Modo privado opcional:

```text
1. Guardar GHCR token en SSM Parameter Store o Secrets Manager.
2. Dar al IAM Role de EC2 permiso para leer ese secreto/parámetro.
3. En user_data o script de bootstrap, hacer docker login ghcr.io.
4. Ejecutar docker compose pull.
```

Para V3.2 base, se recomienda evitar este camino y usar imágenes públicas para reducir fricción.

---

### 38.2 Red y accesibilidad

Decisión V3.2:

```text
lo más simple posible
todo público donde sea necesario
datos ficticios
security groups mínimos pero permisivos para el lab
```

Modelo:

```text
EC2 con IP pública
servicios HTTP expuestos en puertos definidos
/health público
/metrics público o restringido por IP del docente si se puede resolver fácil
RDS accesible desde SG de la EC2 correspondiente
```

Regla pragmática:

```text
si allowlist de IPs complica la clase, usar exposición pública temporal con datos ficticios y cleanup estricto
```

Nota pedagógica que debe decirse explícitamente:

> Esta red está simplificada para un laboratorio. No es una recomendación production-grade.

---

### 38.3 Ownership y containers por voluntario

Decisión V3.2:

```text
cada voluntario tiene ownership de una cuenta y de su stack
cada stack usa Docker Compose
cada stack puede correr uno o más containers
```

Distribución:

```text
Voluntario 1:
  order-management

Voluntario 2:
  fulfillment-planning
  shipment-preparation

Voluntario 3:
  buyer-order-tracking

Docente:
  Prometheus
  Grafana
  Alertmanager
  Loki
  load generator
```

Esto mantiene ownership claro sin forzar una EC2 por microservicio.

---

### 38.4 Docker Compose

Decisión V3.2:

```text
Docker Compose será el mecanismo estándar para correr servicios en EC2.
```

Cada voluntario tendrá algo como:

```text
compose.yml
.env
Makefile
```

Ejemplo conceptual por cuenta:

```text
vol1-order/
  compose.yml
  .env.order
  Makefile

vol2-fulfillment-shipment/
  compose.yml
  .env.fulfillment
  .env.shipment
  Makefile

vol3-tracking/
  compose.yml
  .env.tracking
  Makefile
```

---

### 38.5 Reinicio de containers y cambios de env

Decisión V3.2:

```text
los cambios de comportamiento de app se aplican modificando envs y recreando containers con Docker Compose
```

Comandos de bajo nivel:

```bash
docker compose pull
docker compose up -d
docker compose up -d --force-recreate <service>
docker compose logs -f <service>
docker compose ps
```

Pero para alumnos, se recomienda usar `make` targets.

Targets mínimos sugeridos:

```text
make up
make ps
make logs
make restart
make down
make fix-promesa
make fix-tracking
make noisy-logs-off
```

Targets específicos por voluntario:

```text
Voluntario 1:
  make send-payment
  make send-duplicate-payment
  make enable-idempotency
  make restart-order

Voluntario 2:
  make disable-promesa-express
  make increase-workers
  make fix-shipment-iam
  make restart-fulfillment
  make restart-shipment

Voluntario 3:
  make fix-tracking-lag
  make query-tracking
  make restart-tracking
```

---

### 38.6 Datos iniciales estimados

Decisión V3.2:

Usar pocos SKUs, con uno problemático y dos sanos.

```text
SKU: MATE-STANLEY-NO-OFICIAL
stock inicial: 8
uso: SKU caliente de Black Friday, propenso a stock bajo

SKU: CARPINCHO-USB-C
stock inicial: 50
uso: SKU normal para happy path

SKU: TECLADO-MECANICO-RUIDOSO
stock inicial: 30
uso: SKU normal, útil para comparar
```

Regla:

```text
happy path usa SKU normal
burst de incidente usa SKU caliente
```

---

### 38.7 Carga estimada

Decisión V3.2:

El docente dispara carga controlada desde su máquina o stack docente.

Escenarios sugeridos:

```text
Smoke test:
  1 orden
  concurrencia 1
  duplicados 0%

Burst chico:
  20 órdenes
  concurrencia 5
  duplicados 10%

Burst moderado:
  50 órdenes
  concurrencia 10
  duplicados 15%

Burst de recuperación:
  20 órdenes
  concurrencia 5
  duplicados 10%
```

Objetivo:

```text
mostrar degradación visible sin hacer un test de performance real
```

No se busca saturar AWS ni generar costo relevante.

---

### 38.8 Alertas simples

Decisión V3.2:

Alertmanager tendrá pocas alertas y nombres entendibles.

Alertas sugeridas:

```text
CriticalOrderJourneySlow
TrackingFreshnessHigh
ShipmentDocumentFailures
EventBacklogGrowing
DuplicatePaymentSpike
```

Regla:

```text
las alertas deben apuntar a síntomas o impacto de usuario, no a métricas técnicas aisladas
```

CPU alta puede existir como panel distractor, pero no debería ser alerta principal salvo que impacte el SLO.

---

### 38.9 Evidencias fallback

Decisión V3.2:

Preparar evidencia precapturada mínima. No hay cuenta AWS fallback completa, así que los artefactos de respaldo son importantes.

Evidencias obligatorias:

```text
1. Captura del dashboard con SLO degradado.
2. Captura del dashboard con SLO recuperado.
3. Log de Promesa Express agregando latencia/error.
4. Log de duplicate payment ignored.
5. Log de AccessDenied en shipment-preparation.
6. Captura/listado de objeto S3 creado tras fix.
7. JSON de tracking stale.
8. JSON de tracking corregido.
9. terraform plan del fix IAM.
10. Nota de guardia ejemplo.
```

Como no habrá cuenta fallback, cada stage debe poder convertirse a tabletop con estas evidencias.

---

### 38.10 Acceso operativo: SSH y SSM

Decisión V3.2:

```text
permitir ambas opciones: SSH y SSM Session Manager
```

Camino simple:

```text
SSH habilitado con keypair temporal para el lab
```

Camino más prolijo:

```text
SSM Session Manager si la AMI, IAM role y conectividad lo permiten
```

Recomendación práctica:

```text
preparar SSH como fallback aunque se intente usar SSM
```

Motivo:

```text
SSM es más prolijo, pero puede agregar fricción si falta algún detalle de IAM/agent/network.
SSH es menos elegante, pero más predecible en clase.
```

---

### 38.11 Sin fallback cloud completo

Decisión V3.2:

```text
no habrá cuenta AWS docente fallback con todo desplegado
```

Compensación:

```text
evidencias precapturadas
modo tabletop por stage
outputs esperados
payloads preparados
logs de ejemplo
capturas de Grafana
```

Implicación:

> La clase debe estar diseñada para que una demo fallida no bloquee la discusión ni el aprendizaje.

---

## 39. Preguntas pendientes para V4 técnica

Estas preguntas ya son de implementación fina.

1. ¿Las imágenes GHCR serán públicas o privadas con token?
2. ¿Cuál será la AMI base para EC2?
3. ¿Docker y Compose se instalarán por user_data o vendrán en una AMI preparada?
4. ¿Qué puertos exactos usará cada servicio?
5. ¿Qué puertos exactos scrapeará Prometheus?
6. ¿Cómo se generará el archivo `.env` desde Terraform outputs?
7. ¿Cómo se pasarán endpoints entre voluntarios durante la clase?
8. ¿Qué formato tendrá el archivo de targets Prometheus?
9. ¿Qué script exacto usará el docente para generar carga?
10. ¿Cómo se parametrizará el stock inicial?
11. ¿Qué Makefile exacto tendrá cada voluntario?
12. ¿Qué comandos se consideran “ruta feliz” y cuáles “ruta de emergencia”?

---

## 40. Frase de cierre sugerida

> **Hoy usamos AWS, Terraform, EC2, SQS, RDS, S3, DynamoDB y métricas. Pero el problema real no era aprender nombres de servicios: era sostener una promesa de negocio cuando tráfico, cambios y deuda técnica llegan juntos a producción.**

Versión más filosa:

> **Cloud no arregla malas decisiones: las escala más rápido.**
