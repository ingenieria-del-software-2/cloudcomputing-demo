# Consolidado V3 sobre V2 - 14-cierre-riesgos-adrs-cleanup

> Estado: V3 aplicado como base actual. El detalle de V2 queda preservado debajo para evitar perdida de contenido durante la mezcla.

## Base V3 actual

## 31. Criterios de éxito de la experiencia

La clase fue exitosa si los alumnos pueden explicar:

```text
1. Por qué el flujo crítico no termina en “orden creada”.
2. Por qué una compra pagada puede seguir siendo un incidente.
3. Qué SLO representa dolor real del comprador.
4. Por qué CPU alta puede ser ruido.
5. Por qué un sistema puede estar up y aun así estar mal.
6. Por qué Promesa Express se puede degradar sin destruir el negocio.
7. Por qué idempotencia importa durante Black Friday.
8. Por qué IAM puede bloquear un flujo de negocio.
9. Por qué tracking viejo es un problema de confiabilidad.
10. Cómo Terraform ayuda a auditar y corregir cambios.
11. Qué guardrail habría evitado repetir el incidente.
```

---

## 32. Nota de guardia final

Template:

```text
Incidente:
Black Friday / Order-to-Ship degradado en CompraFiubi

Impacto:

SLO afectado:

Síntoma principal:

Cambios contribuyentes:

Mitigaciones aplicadas:

Riesgo aceptado:

Qué sacrificamos:

Qué no volveríamos a hacer:

Acción preventiva:
```

Ejemplo esperado:

```text
Incidente:
Black Friday / Order-to-Ship degradado en CompraFiubi

Impacto:
Compradores con pago aprobado veían tracking atrasado.
Algunos shipments quedaban bloqueados por falta de documentos.

SLO afectado:
critical_order_journey_under_60s_ratio

Síntoma principal:
Backlog en fulfillment y tracking stale.

Cambios contribuyentes:
Promesa Express activada con latencia.
Worker concurrency baja.
Permiso S3 incompleto para shipment-preparation.

Mitigaciones aplicadas:
Desactivar Promesa Express.
Corregir permiso s3:PutObject mínimo.
Priorizar eventos buyer-facing.

Riesgo aceptado:
Promesa logística menos precisa durante ventana crítica.

Qué sacrificamos:
Promesa Express y detalle fino de entrega.

Acción preventiva:
Freeze de cambios antes de eventos críticos.
Feature flags obligatorios.
SLO de journey antes de launch.
Runbook de rollback.
```

---

## 33. Cleanup

Cleanup es parte del state of done.

Checklist final:

```text
[ ] terraform destroy ejecutado o programado
[ ] EC2 terminadas
[ ] RDS eliminado si aplica
[ ] snapshots no deseados revisados
[ ] buckets S3 vacíos/eliminados
[ ] colas SQS eliminadas
[ ] tablas DynamoDB eliminadas
[ ] security groups no usados eliminados
[ ] no Elastic IPs huérfanas
[ ] no Load Balancers creados
```

Nota:

> Si algo no se puede destruir en vivo por tiempo, debe quedar comando exacto y responsable claro.

---

## 34. Fallbacks

### Si Terraform falla

```text
Usar cuenta docente fallback.
Mostrar terraform plan esperado.
Pasar a modo tabletop del stage.
```

### Si RDS tarda o falla

```text
Usar DB local/containerizada como fallback.
Mantener discusión conceptual de RDS.
```

### Si Prometheus/Grafana no scrapea

```text
Usar endpoints /metrics manuales.
Usar capturas precargadas.
Usar logs stdout.
```

### Si falla integración entre cuentas

```text
Usar eventos manuales por curl.
Usar payloads prearmados.
Simular downstream con endpoint local.
```

### Si falla S3/IAM demasiado pronto

```text
Convertirlo en incidente narrativo.
Usar documento mock.
Mostrar policy esperada.
```

### Si el tiempo se corta

Prioridad de stages:

```text
Obligatorios:
1. Briefing
2. SLO de emergencia
3. Deploy mínimo o fallback
4. Promesa Express
5. Nota de guardia

Recortables:
- tracking stale separado
- payment duplicado
- CPU distractora
```

---

## 35. Plan de clase V3, alto nivel

```text
00:00–00:15  Stage 0 — Briefing Black Friday
00:15–00:30  Stage 1 — SLO de emergencia
00:30–01:05  Stage 2 — Deploy heredado/degradado
01:05–01:25  Stage 3 — Happy path sospechoso
01:25–01:55  Stage 4 — Promesa Express degrada fulfillment
01:55–02:20  Stage 5 — IAM bloquea shipment documents
02:20–02:45  Stage 6 — Tracking stale / verdad visible
02:45–03:00  Stage 7 — Nota de guardia + cleanup
```

No hay pausa formal en V3, pero el ritmo debe alternar:

```text
demo breve
discusión breve
decisión
aplicar cambio
evidencia
```

---

## 36. ADRs V3

### ADR-001 — SRE-first GameDay

**Decisión:** la clase se estructura como incidente SRE, no como despliegue lineal.

**Motivo:** alumnos avanzados, evitar AWS 101, conectar arquitectura con operación.

**Tradeoff:** menos tiempo para explicar cada servicio individualmente.

---

### ADR-002 — Order-to-Ship como flujo crítico

**Decisión:** mantener Order-to-Ship como journey principal.

**Motivo:** combina orden, fulfillment, shipment, tracking, asincronía, estado y operación.

**Tradeoff:** es más complejo que un simple checkout.

---

### ADR-003 — 4 microservicios reales

**Decisión:** mantener 4 microservicios.

**Motivo:** permite mostrar responsabilidades diferenciadas y servicios AWS variados.

**Tradeoff:** un voluntario opera dos servicios.

---

### ADR-004 — EC2 + Docker como runtime

**Decisión:** usar EC2 con containers Docker.

**Motivo:** enfoque cloud clásico, visible, razonable para enseñar VMs, roles, SGs y deploy.

**Tradeoff:** más setup que serverless.

---

### ADR-005 — Prometheus/Grafana como observabilidad principal

**Decisión:** usar stack docente de observabilidad en vez de CloudWatch como tablero principal.

**Motivo:** experiencia más clara en vivo para SLOs, alertas y war room.

**Tradeoff:** requiere operar stack docente externo.

---

### ADR-006 — No cross-account SQS en V3 base

**Decisión:** evitar cross-account IAM/SQS en la versión base.

**Motivo:** reduce riesgo logístico y deja más tiempo a SRE/arquitectura.

**Tradeoff:** el event-driven cross-account no es puro.

---

### ADR-007 — SQS local por servicio/cuenta

**Decisión:** usar SQS local como buffer/backlog interno de cada servicio.

**Motivo:** permite enseñar colas, retries, backlog e idempotencia sin integración cross-account compleja.

**Tradeoff:** la publicación entre servicios usa HTTP forwarding en V3.

---

### ADR-008 — SLO de journey corto

**Decisión:** usar 60 segundos como ventana didáctica del journey.

**Motivo:** evita esperar demasiado en clase y permite feedback rápido.

**Tradeoff:** no representa necesariamente un SLO realista.

---

### ADR-009 — Feature degradable

**Decisión:** Promesa Express puede apagarse o degradarse.

**Motivo:** enseña graceful degradation y priorización de flujo crítico.

**Tradeoff:** se sacrifica experiencia/producto temporalmente.

---

### ADR-010 — IAM como incidente, no como clase completa

**Decisión:** incluir una falla IAM concreta en shipment-preparation.

**Motivo:** muestra que seguridad/configuración impacta negocio.

**Tradeoff:** no se profundiza en seguridad avanzada.

---

## 37. Decisiones de implementación cerradas para V3.1

Estas decisiones se cierran a partir de las respuestas del docente y pasan a orientar la implementación técnica.

### 37.1 Observabilidad docente

El docente tendrá un stack público accesible desde las cuentas de los voluntarios:

```text
Prometheus
Grafana
Alertmanager
Loki
```

Los servicios deberán exponer métricas Prometheus por HTTP, idealmente en:

```text
GET /metrics
```

Los logs podrán ir por dos caminos:

```text
stdout del container como fallback mínimo
Loki como agregación opcional/principal si está operativo
```

Decisión:

> Grafana/Prometheus/Loki serán el tablero de war room. AWS CloudWatch no será la interfaz principal de observabilidad de la clase.

---

### 37.2 Red y exposición

Para V3.1 se asume una red simple y pública.

```text
EC2 públicas
endpoints HTTP públicos
/metrics público o protegido solo por security group/IP allowlist simple
RDS accesible desde la EC2 correspondiente
servicios integrados por HTTP entre cuentas
```

Esto es una simplificación consciente para una clase de 3 horas.

Tradeoff:

```text
+ reduce fricción de networking
+ permite integración entre cuentas sin cross-account IAM complejo
- no representa un diseño de red production-grade
- requiere cuidado con datos ficticios y cleanup
```

Nota pedagógica:

> La simplificación de red no debe venderse como buena práctica productiva. Se usa para que la clase pueda concentrarse en SRE, arquitectura y trade-offs.

---

### 37.3 Imágenes Docker

Como no habrá cambios de código durante la clase, no hace falta rebuild de imágenes en vivo.

Decisión V3.1:

```text
usar imágenes Docker preconstruidas
publicadas antes de la clase
preferentemente en GHCR o Docker Hub
```

ECR queda fuera del camino crítico.

Motivo:

```text
reduce setup
reduce permisos AWS necesarios
evita enseñar registry/deploy pipeline cuando no es el foco
```

Fallback:

```text
si falla el registry, usar imagen ya presente en la EC2 o build local predefinido
```

---

### 37.4 RDS

RDS PostgreSQL se mantiene como servicio real en V3.1.

Decisión:

```text
order-management usa RDS PostgreSQL
fulfillment-planning y shipment-preparation usan RDS PostgreSQL
buyer-order-tracking usa DynamoDB
```

Para reducir costo y tiempo, fulfillment y shipment pueden compartir una misma instancia RDS con bases o schemas separados.

---

### 37.5 UI

No se prioriza una UI completa.

Decisión:

```text
endpoints JSON son suficientes para la clase
```

Endpoint principal visible:

```http
GET /orders/{order_id}/tracking
```

Una mini UI puede existir como bonus, pero no debe ser dependencia del taller.

---

### 37.6 Generación de carga

El docente dispara la simulación de Black Friday.

Decisión:

```text
la carga no la disparan los voluntarios
el docente controla volumen, duplicados y ritmo
```

Simulación sugerida para V3.1:

```text
happy path: 1 orden
burst pequeño: 20 órdenes
burst moderado: 50 órdenes
porcentaje duplicados: 10–15%
concurrencia inicial: 5 requests paralelos
concurrencia máxima recomendada: 10 requests paralelos
```

Esto debería alcanzar para mostrar:

```text
latencia
backlog
tracking freshness
duplicados
mejora tras mitigación
```

sin generar costos relevantes ni convertir la clase en prueba de performance real.

---

### 37.7 Cambios de configuración / curas

La mayoría de las curas se aplican por cambios de environment variables y restart de container.

Decisión V3.1:

```text
no usar Terraform para cada cambio de comportamiento de aplicación
usar Terraform para infraestructura
usar env/config + restart para curas de runtime
```

Ejemplos:

```text
PROMESA_EXPRESS_ENABLED=false
PROMESA_EXPRESS_LATENCY_MS=0
PROMESA_EXPRESS_ERROR_RATE=0
TRACKING_CONSUMER_DELAY_MS=0
WORKER_CONCURRENCY=3
LOG_LEVEL=info
```

Mecanismo recomendado:

```text
.env por servicio
Docker Compose por EC2
make targets simples
```

Ejemplo conceptual:

```bash
make disable-promesa-express
make restart-fulfillment
```

Por debajo, puede hacer:

```bash
sed -i 's/PROMESA_EXPRESS_ENABLED=true/PROMESA_EXPRESS_ENABLED=false/' .env.fulfillment
docker compose up -d --force-recreate fulfillment-planning
```

Para fallas de infraestructura, como IAM/S3, sí se usa Terraform:

```text
terraform plan
terraform apply
```

---

### 37.8 Evidencia precapturada

V3.1 debe incluir fallback visual mínimo por stage.

Evidencias recomendadas:

```text
captura de Grafana con SLO degradado
captura de Grafana con SLO recuperado
log de Promesa Express generando latencia
log de AccessDenied en shipment-preparation
captura/listado de objeto creado en S3 tras fix
respuesta JSON de tracking stale
respuesta JSON de tracking corregido
terraform plan del fix IAM
payloads de prueba
nota de guardia ejemplo
```

Estas evidencias no reemplazan la demo, pero evitan que la clase dependa de que todo funcione perfecto.

---

### 37.9 Grabación async

La versión async será la grabación de la clase en vivo.

Recomendación:

```text
hacer preguntas explícitas antes de revelar cada mitigación
pausar verbalmente 10–15 segundos para que quien vea grabado pueda pensar
nombrar cada stage de forma clara
```

---

## 38. Decisiones de implementación cerradas para V3.2

Estas decisiones cierran los pendientes de V3.1 y bajan el diseño a un nivel suficientemente concreto para pasar luego a módulos Terraform, Compose files y runbooks.

### 38.1 Container registry

Decisión V3.2:

```text
Registry base: GHCR
Imágenes: preconstruidas
Rebuild en clase: no
ECR: fuera del camino crítico
```

Opción recomendada para simplificar:

```text
imágenes públicas en GHCR
pull anónimo desde EC2
```

Aclaración importante:

> El IAM Role de EC2 no autentica directamente contra GHCR. El IAM Role sirve para permisos AWS. Si las imágenes de GHCR son privadas, la EC2 necesitará un token de GitHub para hacer docker login.

Modo privado opcional:

```text
1. Guardar GHCR token en SSM Parameter Store o Secrets Manager.
2. Dar al IAM Role de EC2 permiso para leer ese secreto/parámetro.
3. En user_data o script de bootstrap, hacer docker login ghcr.io.
4. Ejecutar docker compose pull.
```

Para V3.2 base, se recomienda evitar este camino y usar imágenes públicas para reducir fricción.

---

### 38.2 Red y accesibilidad

Decisión V3.2:

```text
lo más simple posible
todo público donde sea necesario
datos ficticios
security groups mínimos pero permisivos para el lab
```

Modelo:

```text
EC2 con IP pública
servicios HTTP expuestos en puertos definidos
/health público
/metrics público o restringido por IP del docente si se puede resolver fácil
RDS accesible desde SG de la EC2 correspondiente
```

Regla pragmática:

```text
si allowlist de IPs complica la clase, usar exposición pública temporal con datos ficticios y cleanup estricto
```

Nota pedagógica que debe decirse explícitamente:

> Esta red está simplificada para un laboratorio. No es una recomendación production-grade.

---

### 38.3 Ownership y containers por voluntario

Decisión V3.2:

```text
cada voluntario tiene ownership de una cuenta y de su stack
cada stack usa Docker Compose
cada stack puede correr uno o más containers
```

Distribución:

```text
Voluntario 1:
  order-management

Voluntario 2:
  fulfillment-planning
  shipment-preparation

Voluntario 3:
  buyer-order-tracking

Docente:
  Prometheus
  Grafana
  Alertmanager
  Loki
  load generator
```

Esto mantiene ownership claro sin forzar una EC2 por microservicio.

---

### 38.4 Docker Compose

Decisión V3.2:

```text
Docker Compose será el mecanismo estándar para correr servicios en EC2.
```

Cada voluntario tendrá algo como:

```text
compose.yml
.env
Makefile
```

Ejemplo conceptual por cuenta:

```text
vol1-order/
  compose.yml
  .env.order
  Makefile

vol2-fulfillment-shipment/
  compose.yml
  .env.fulfillment
  .env.shipment
  Makefile

vol3-tracking/
  compose.yml
  .env.tracking
  Makefile
```

---

### 38.5 Reinicio de containers y cambios de env

Decisión V3.2:

```text
los cambios de comportamiento de app se aplican modificando envs y recreando containers con Docker Compose
```

Comandos de bajo nivel:

```bash
docker compose pull
docker compose up -d
docker compose up -d --force-recreate <service>
docker compose logs -f <service>
docker compose ps
```

Pero para alumnos, se recomienda usar `make` targets.

Targets mínimos sugeridos:

```text
make up
make ps
make logs
make restart
make down
make fix-promesa
make fix-tracking
make noisy-logs-off
```

Targets específicos por voluntario:

```text
Voluntario 1:
  make send-payment
  make send-duplicate-payment
  make enable-idempotency
  make restart-order

Voluntario 2:
  make disable-promesa-express
  make increase-workers
  make fix-shipment-iam
  make restart-fulfillment
  make restart-shipment

Voluntario 3:
  make fix-tracking-lag
  make query-tracking
  make restart-tracking
```

---

### 38.6 Datos iniciales estimados

Decisión V3.2:

Usar pocos SKUs, con uno problemático y dos sanos.

```text
SKU: MATE-STANLEY-NO-OFICIAL
stock inicial: 8
uso: SKU caliente de Black Friday, propenso a stock bajo

SKU: CARPINCHO-USB-C
stock inicial: 50
uso: SKU normal para happy path

SKU: TECLADO-MECANICO-RUIDOSO
stock inicial: 30
uso: SKU normal, útil para comparar
```

Regla:

```text
happy path usa SKU normal
burst de incidente usa SKU caliente
```

---

### 38.7 Carga estimada

Decisión V3.2:

El docente dispara carga controlada desde su máquina o stack docente.

Escenarios sugeridos:

```text
Smoke test:
  1 orden
  concurrencia 1
  duplicados 0%

Burst chico:
  20 órdenes
  concurrencia 5
  duplicados 10%

Burst moderado:
  50 órdenes
  concurrencia 10
  duplicados 15%

Burst de recuperación:
  20 órdenes
  concurrencia 5
  duplicados 10%
```

Objetivo:

```text
mostrar degradación visible sin hacer un test de performance real
```

No se busca saturar AWS ni generar costo relevante.

---

### 38.8 Alertas simples

Decisión V3.2:

Alertmanager tendrá pocas alertas y nombres entendibles.

Alertas sugeridas:

```text
CriticalOrderJourneySlow
TrackingFreshnessHigh
ShipmentDocumentFailures
EventBacklogGrowing
DuplicatePaymentSpike
```

Regla:

```text
las alertas deben apuntar a síntomas o impacto de usuario, no a métricas técnicas aisladas
```

CPU alta puede existir como panel distractor, pero no debería ser alerta principal salvo que impacte el SLO.

---

### 38.9 Evidencias fallback

Decisión V3.2:

Preparar evidencia precapturada mínima. No hay cuenta AWS fallback completa, así que los artefactos de respaldo son importantes.

Evidencias obligatorias:

```text
1. Captura del dashboard con SLO degradado.
2. Captura del dashboard con SLO recuperado.
3. Log de Promesa Express agregando latencia/error.
4. Log de duplicate payment ignored.
5. Log de AccessDenied en shipment-preparation.
6. Captura/listado de objeto S3 creado tras fix.
7. JSON de tracking stale.
8. JSON de tracking corregido.
9. terraform plan del fix IAM.
10. Nota de guardia ejemplo.
```

Como no habrá cuenta fallback, cada stage debe poder convertirse a tabletop con estas evidencias.

---

### 38.10 Acceso operativo: SSH y SSM

Decisión V3.2:

```text
permitir ambas opciones: SSH y SSM Session Manager
```

Camino simple:

```text
SSH habilitado con keypair temporal para el lab
```

Camino más prolijo:

```text
SSM Session Manager si la AMI, IAM role y conectividad lo permiten
```

Recomendación práctica:

```text
preparar SSH como fallback aunque se intente usar SSM
```

Motivo:

```text
SSM es más prolijo, pero puede agregar fricción si falta algún detalle de IAM/agent/network.
SSH es menos elegante, pero más predecible en clase.
```

---

### 38.11 Sin fallback cloud completo

Decisión V3.2:

```text
no habrá cuenta AWS docente fallback con todo desplegado
```

Compensación:

```text
evidencias precapturadas
modo tabletop por stage
outputs esperados
payloads preparados
logs de ejemplo
capturas de Grafana
```

Implicación:

> La clase debe estar diseñada para que una demo fallida no bloquee la discusión ni el aprendizaje.

---

## 39. Preguntas pendientes para V4 técnica

Estas preguntas ya son de implementación fina.

1. ¿Las imágenes GHCR serán públicas o privadas con token?
2. ¿Cuál será la AMI base para EC2?
3. ¿Docker y Compose se instalarán por user_data o vendrán en una AMI preparada?
4. ¿Qué puertos exactos usará cada servicio?
5. ¿Qué puertos exactos scrapeará Prometheus?
6. ¿Cómo se generará el archivo `.env` desde Terraform outputs?
7. ¿Cómo se pasarán endpoints entre voluntarios durante la clase?
8. ¿Qué formato tendrá el archivo de targets Prometheus?
9. ¿Qué script exacto usará el docente para generar carga?
10. ¿Cómo se parametrizará el stock inicial?
11. ¿Qué Makefile exacto tendrá cada voluntario?
12. ¿Qué comandos se consideran “ruta feliz” y cuáles “ruta de emergencia”?

---

## 40. Frase de cierre sugerida

> **Hoy usamos AWS, Terraform, EC2, SQS, RDS, S3, DynamoDB y métricas. Pero el problema real no era aprender nombres de servicios: era sostener una promesa de negocio cuando tráfico, cambios y deuda técnica llegan juntos a producción.**

Versión más filosa:

> **Cloud no arregla malas decisiones: las escala más rápido.**

---

## Detalle V2 conservado

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
