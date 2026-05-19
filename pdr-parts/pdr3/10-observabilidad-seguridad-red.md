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

