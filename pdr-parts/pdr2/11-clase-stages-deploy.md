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

