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

