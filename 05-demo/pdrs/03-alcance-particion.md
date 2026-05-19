# Consolidado V3 sobre V2 - 03-alcance-particion

> Estado: V3 aplicado como base actual. El detalle de V2 queda preservado debajo para evitar perdida de contenido durante la mezcla.

## Base V3 actual

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


---

## Detalle V2 conservado

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

