# Consolidado V3 sobre V2 - 11-clase-stages-deploy

> Estado: V3 aplicado como base actual. El detalle de V2 queda preservado debajo para evitar perdida de contenido durante la mezcla.

## Base V3 actual

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


---

## Detalle V2 conservado

# 21. Modos de despliegue para clase

## Modo principal v2 — Una cuenta, 3 voluntarios

Es el modo recomendado para el GameDay. Reduce coordinación de cuentas y permite que el aula se enfoque en contratos, síntomas, SLOs y mitigaciones.

```text
Voluntario 1: Checkout / Order Team
- order-management
- entrada de pagos simulada

Voluntario 2: Fulfillment / Shipping Team
- fulfillment-planning
- shipment-preparation

Voluntario 3: SRE / Buyer Experience Team
- buyer-order-tracking
- tablero de incidente
- health checks
- evidencia con correlation_id
```

Recursos por grupo:

```text
- 4 EC2 o menos si se agrupan servicios para el laboratorio
- 3 RDS pequeñas o 1 RDS con 3 DBs/schemas separados para lab
- 1 DynamoDB
- 1 S3
- 4 SQS + DLQs
- CloudWatch Logs/Metrics
```

Para una clase, se puede aceptar **una instancia RDS con varias bases/schema** por costo, aclarando que conceptualmente cada servicio es dueño de su DB.

## Modo alternativo — 4 voluntarios

Si aparece un cuarto voluntario, se puede separar `shipment-preparation` y dejar `buyer-order-tracking`/SRE como rol dedicado.

| Voluntario | Servicio / rol                  |
| ---------- | ------------------------------- |
| 1          | `order-management`              |
| 2          | `fulfillment-planning`          |
| 3          | `shipment-preparation`          |
| 4          | `buyer-order-tracking` / SRE    |

## Extensión — Una cuenta por alumno

Más realista, más complejo.

```text
Alumno A: order-management
Alumno B: fulfillment-planning
Alumno C: shipment-preparation
Alumno D: buyer-order-tracking
```

Requiere policies cross-account en SQS/S3 y coordinación de ARNs.

## Recomendación

Para primera iteración:

```text
Modo principal v2: una cuenta por grupo con 3 voluntarios
```

Luego, como extensión:

```text
Modo B: cross-account
```

---

# 22. Plan de clase sugerido

## Duración recomendada

```text
3 horas
```

## 0:00–0:15 — Apertura: Black Friday en llamas

```text
Contexto narrativo.
Roles.
Flujo crítico.
Mapa mental del incidente.
```

Storytelling:

```text
Son las 23:55.
MercadoFuego abre Black Friday en 5 minutos.
Producto lanzó Promesa Express.
Infra aplicó optimizaciones.
Seguridad ajustó permisos.
Observabilidad subió el nivel de logs.

A las 00:03 hay reclamos, backlog, tracking atrasado y sellers sin etiquetas.
```

Pregunta al aula:

> ¿Cuál es el flujo que no puede romperse aunque todo lo demás se degrade?

Done de etapa:

```text
[ ] El negocio está entendido.
[ ] El flujo crítico está identificado.
[ ] Los equipos están asignados.
[ ] La clase entiende que no vamos a optimizar todo.
```

## 0:15–0:30 — SLO de emergencia

```text
Elegir SLI/SLO.
Separar dolor de usuario de métricas técnicas.
Declarar severidad.
```

Pregunta al aula:

> ¿Qué métrica representa dolor del comprador?

SLO inicial sugerido:

```text
El 95% de pagos aprobados debe llegar a tracking visible
en menos de 2 minutos,
sin duplicar órdenes
y sin vender stock inexistente.
```

Checklist:

```text
[ ] Elegimos un flujo crítico.
[ ] Elegimos 1 o 2 SLIs.
[ ] Definimos umbral y ventana.
[ ] Diferenciamos métrica de negocio vs métrica técnica.
[ ] Declaramos severidad del incidente.
```

## 0:30–0:55 — Deploy mínimo por voluntarios

```text
Voluntario 1: order/checkout.
Voluntario 2: fulfillment/shipping.
Voluntario 3: tracking/SRE.
```

Actividad:

```text
terraform init
terraform apply
verificación de health checks
outputs mínimos compartidos
correlation_id visible en logs
```

Pregunta al aula:

> ¿Qué depende de quién?

Done de etapa:

```text
[ ] order-management responde.
[ ] fulfillment/shipment están activos.
[ ] buyer-tracking responde.
[ ] Se puede simular un pago aprobado.
[ ] Hay logs con correlation_id.
[ ] Hay cleanup preparado.
```

## 0:55–1:15 — Happy path sospechoso

```text
Simular pago aprobado.
Ver orden.
Ver fulfillment.
Ver shipment.
Ver tracking.
```

Actividad:

```text
simular pago aprobado
ver orden confirmada
ver fulfillment commitment
ver shipment ready
ver tracking actualizado
```

Pregunta al aula:

> ¿Esto prueba salud o solo ausencia momentánea de evidencia?

Done de etapa:

```text
[ ] Hay una orden visible.
[ ] Hay stock reservado.
[ ] Hay shipment/documento.
[ ] Hay tracking visible.
[ ] Se puede reconstruir el recorrido con logs/eventos.
```

## 1:15–1:40 — Incidente Promesa Express

```text
La feature nueva intenta prometer “llega mañana”.
Durante Black Friday aumenta latencia y errores en fulfillment.
Tracking queda congelado en ORDER_CONFIRMED.
```

Pregunta madre:

> ¿Qué mata más negocio: apagar Promesa Express o degradar checkout?

Mitigaciones posibles:

```text
apagar Promesa Express
degradarla a promesa genérica
mantenerla solo para ciertos sellers
aislarla del camino crítico
limitar retries o concurrencia
```

Concepto SRE:

```text
Graceful degradation
```

## 1:40–1:50 — Pausa corta

Tres horas sin pausa degrada la clase igual que un sistema sin backpressure.

## 1:50–2:15 — Incidente cambios de infra

```text
Timeline.
Permisos/shipment/logging/workers.
Elegir rollback o freeze.
```

Timeline base:

```text
23:20 Infra ajusta workers/concurrencia.
23:35 Seguridad cambia permisos.
23:40 Observabilidad sube logging.
23:50 Producto activa Promesa Express.
00:00 Black Friday empieza.
00:03 reclamos.
00:08 backlog.
00:12 tracking atrasado.
```

Pregunta al aula:

> ¿Rollback de qué, si cambiaron cinco cosas?

Checklist:

```text
[ ] Construimos timeline del incidente.
[ ] Separamos síntomas de cambios candidatos.
[ ] Elegimos primer rollback o mitigación.
[ ] Congelamos cambios no críticos.
[ ] Definimos qué evidencia esperamos ver si funciona.
```

Concepto SRE:

```text
Change management + rollback discipline
```

## 2:15–2:40 — Backlog, shipment y tracking

```text
El sistema no cae; se atrasa.
order-management sigue aceptando pagos.
fulfillment acumula cola.
shipment falla por permisos o documentos.
tracking visible queda viejo.
```

Preguntas:

```text
¿Escalar arregla el incidente o solo lo hace más caro?
¿Aceptaríamos un permiso más amplio por 30 minutos?
¿El sistema está vivo si el comprador ve una mentira?
```

Decisiones posibles:

```text
escalar workers selectivamente
limitar entrada
priorizar eventos críticos
corregir permiso mínimo
aplicar permiso temporal con expiración
mostrar estado visible menos engañoso
```

Conceptos SRE:

```text
Backpressure
Queueing
Retries
Idempotencia
Mitigación controlada
Blast radius
User-facing reliability
```

## 2:40–2:55 — Postmortem de bolsillo

La pregunta incorrecta es:

```text
¿Quién rompió producción?
```

La pregunta correcta es:

```text
¿Qué condiciones hicieron razonable que esto pasara?
```

Formato de nota:

```text
Impacto:
Síntoma principal:
SLO degradado:
Cambios contribuyentes:
Mitigación aplicada:
Riesgo aceptado:
Acción preventiva:
Qué no volveríamos a hacer:
```

Pregunta final:

> ¿Qué guardrail habría prevenido esto sin pedirle a la gente que sea perfecta?

## 2:55–3:00 — Cleanup y cierre conceptual

```text
terraform destroy
verificación de recursos eliminados
cierre conceptual
```

Frase posible:

> Hoy usamos AWS. El problema real no era AWS. Era sostener una promesa de negocio cuando tráfico, cambios y deuda técnica llegan todos juntos a producción.

## State of done por etapa

| Etapa            | Done narrativo                | Evidencia mínima                  | Decisión del aula              |
| ---------------- | ----------------------------- | --------------------------------- | ------------------------------ |
| Briefing         | Flujo crítico identificado    | Mapa simple Order-to-Ship         | Qué salva el negocio           |
| SLO emergencia   | SLO elegido                   | SLI + umbral + ventana            | Qué métrica manda              |
| Deploy mínimo    | Partes activas                | Health checks / outputs Terraform | Qué contrato une equipos       |
| Happy path       | Una compra fluye              | Tracking final + correlation_id   | Si confiamos o no              |
| Feature falla    | Promesa Express degrada flujo | Latencia/backlog/error visible    | Apagar, degradar o aislar      |
| Infra changes    | Timeline armado               | Lista de cambios                  | Qué revertir primero           |
| Backlog          | Sistema atrasado, no caído    | Queue depth / tracking lag        | Escalar, limitar o priorizar   |
| Shipment blocked | Documento/etiqueta falla      | Error de permiso o storage        | Fix mínimo vs permiso temporal |
| Tracking stale   | Comprador ve estado viejo     | Freshness degradada               | Qué estado mostrar             |
| Postmortem       | Aprendizaje registrado        | Nota de incidente                 | Guardrail futuro               |

---

