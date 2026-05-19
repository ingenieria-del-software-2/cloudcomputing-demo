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

