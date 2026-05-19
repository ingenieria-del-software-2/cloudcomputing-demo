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

