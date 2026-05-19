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
