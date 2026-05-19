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

