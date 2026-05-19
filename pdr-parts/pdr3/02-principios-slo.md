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

