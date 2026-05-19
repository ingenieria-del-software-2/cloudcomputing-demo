# Consolidado V3 sobre V2 - 07-ms-shipment

> Estado: V3 aplicado como base actual. El detalle de V2 queda preservado debajo para evitar perdida de contenido durante la mezcla.

## Base V3 actual

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


---

## Detalle V2 conservado

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

