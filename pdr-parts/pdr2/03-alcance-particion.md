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

