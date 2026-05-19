# Guion completo v1 — **Black Friday en llamas: SRE GameDay para un marketplace**

## Taller de Cloud Computing / AWS / Terraform / SRE — 3 horas

> Caso ficticio inspirado en marketplaces tipo MercadoLibre. No representa ni sugiere la arquitectura interna real de ninguna empresa específica.

---

# 0. Idea madre de la clase

La clase no arranca con:

> “Hoy vamos a ver EC2, SQS, RDS, S3, DynamoDB, CloudWatch e IAM.”

Arranca con:

> “Black Friday empezó hace 3 minutos. Una feature nueva salió a producción. Infra tocó varias cosas. Seguridad cambió permisos. Observabilidad está llena de ruido. El sistema no está completamente caído; está peor: algunas compras avanzan, otras quedan raras, y nadie tiene una verdad común.”

La misión de los alumnos:

> **Recuperar el flujo crítico de compra usando prácticas SRE, decisiones arquitectónicas y evidencia operativa.**

La frase conceptual de toda la clase:

> **Producción no falla solo cuando un servicio se cae. Falla cuando el equipo pierde la capacidad de saber qué está pasando, decidir qué sacrificar y sostener una promesa de negocio.**

---

# 1. Supuestos del guion

Voy a escribir el guion pensando en este formato:

* Clase virtual por Meet.
* 20 alumnos activos aproximadamente.
* 3 voluntarios con cuentas AWS propias o entornos cloud asignados.
* Resto de la clase participa por chat, votaciones y discusión.
* El repo de GitHub contiene los microservicios, Terraform/IaC, scripts y escenarios.
* Las “features nuevas” y fallas se activan por variables de entorno o targets `make`.
* Los detalles como `ERROR_RATE`, `TIMING_90_PERCENTILE`, `RATE_LIMIT`, `SQS_PUBLISH_FAILURE_MODE`, CPU/memory burn, etc., se presentan como **cambios de producto/infra**, no como “trucos de demo”.
* No hace falta que todo el mundo despliegue. Los tres voluntarios operan; el resto analiza, predice, vota y desafía.

Convención del guion:

```text
make ...
```

representa comandos del repo. Por debajo pueden ejecutar Terraform, kubectl, cambios de env vars, smoke tests, scripts de carga o cleanup.

---

# 2. Nombre narrativo

## **MercadoFuego**

Un marketplace ficticio argentino.

Evento:

## **Black Friday / Hot Sale**

Feature problemática:

## **Promesa Express**

Promesa comercial:

> “Comprá ahora y llega mañana.”

Problema técnico oculto:

> Para calcular esa promesa, el sistema agrega más lógica, más dependencias, más presión sobre fulfillment, más eventos y más latencia justo en el camino crítico.

---

# 3. Flujo crítico del negocio

La clase no intenta simular todo un marketplace. Se enfoca en un journey:

```text
pago aprobado
→ orden confirmada
→ fulfillment comprometido
→ shipment preparado
→ tracking visible para comprador
```

O en términos más narrativos:

```text
El comprador pagó.
Ahora el sistema tiene que demostrar que sabe qué vendió,
que puede cumplirlo,
que puede prepararlo para despacho,
y que puede contarle la verdad al comprador.
```

---

# 4. Roles de los 3 voluntarios

## Voluntario 1 — **Checkout / Order Team**

Responsabilidad narrativa:

> “Yo convierto pagos aprobados en órdenes confiables.”

Controla:

* entrada de pagos simulados;
* creación/confirmación de orden;
* síntomas externos del checkout;
* posibles errores, latencia o rate limiting en la entrada.

Frase del rol:

> “Si yo acepto mal una compra, todo lo demás hereda basura.”

---

## Voluntario 2 — **Fulfillment / Shipping Team**

Responsabilidad narrativa:

> “Yo convierto una orden en algo que realmente puede cumplirse y despacharse.”

Controla:

* reserva o compromiso de stock;
* preparación de shipment;
* documentos/etiquetas;
* fallas de workers, backlog, permisos o generación de documentos.

Frase del rol:

> “Una orden confirmada sin fulfillment es solo una promesa peligrosa.”

---

## Voluntario 3 — **SRE / Buyer Experience Team**

Responsabilidad narrativa:

> “Yo digo si el sistema está sano desde el punto de vista del usuario y dejo evidencia.”

Controla:

* tracking visible;
* logs/métricas;
* tablero de incidente;
* SLO;
* correlación end-to-end;
* cleanup final.

Frase del rol:

> “Si no podemos explicar qué pasó, el incidente sigue vivo.”

---

# 5. Rol del resto de la clase

El resto no mira pasivamente. Funciona como **war room**.

Durante toda la clase debe:

* votar decisiones;
* predecir consecuencias antes de aplicar cambios;
* distinguir síntoma, causa probable y mitigación;
* desafiar decisiones de los voluntarios;
* decidir qué sacrificar;
* escribir mentalmente una nota de incidente;
* pensar agnósticamente: “esto hoy es AWS, mañana puede ser GCP, Azure, Kubernetes, bare metal o una mezcla horrible heredada”.

Regla de oro:

> **Nadie toca producción sin decir antes qué espera que pase.**

---

# 6. State of done final

La clase fue exitosa si al final se puede afirmar:

```text
1. Identificamos el flujo crítico de negocio.
2. Definimos un SLO de emergencia centrado en el comprador.
3. Desplegamos o activamos las partes mínimas del sistema.
4. Probamos al menos una compra end-to-end.
5. Detectamos una degradación realista.
6. Aplicamos una mitigación defendible.
7. Distinguimos síntoma, causa probable y acción de contención.
8. Dejamos evidencia con logs/eventos/correlation_id.
9. Declaramos qué riesgo aceptamos.
10. Propusimos un guardrail para no repetir el incidente.
11. Limpiamos recursos o dejamos el cleanup ejecutado/verificado.
```

No buscamos:

```text
arquitectura perfecta
cobertura exhaustiva de AWS
debuggear todos los errores
explicar todos los servicios
```

Buscamos:

> **Producción suficientemente defendible bajo presión.**

---

# 7. Mecánica repetida durante toda la clase

Cada vez que haya una acción técnica, se usa este ciclo:

```text
1. Síntoma
2. Hipótesis
3. Predicción
4. Cambio
5. Evidencia
6. Decisión
7. Riesgo aceptado
```

En versión aula:

```text
¿Qué vemos?
¿Qué creemos que pasa?
¿Qué esperamos que cambie?
¿Qué tocamos?
¿Qué evidencia apareció?
¿Qué decisión tomamos?
¿Qué riesgo queda?
```

Esto evita que la demo se convierta en “mirar comandos”.

---

# 8. Guion minuto a minuto

---

## Bloque 0 — Apertura

### 0:00–0:05 — Slide 1

# **Black Friday en llamas**

### Objetivo

Instalar tono, tensión y expectativa.

### Docente dice

> Hoy no vamos a hacer una clase introductoria de AWS.
> No vamos a recorrer servicios como si fuera un catálogo.
> Hoy entramos a producción cuando producción ya está rara.
>
> Son las 00:03 de Black Friday. MercadoFuego acaba de lanzar una feature comercialmente preciosa llamada Promesa Express: “comprá ahora y llega mañana”.
>
> El problema: producto lanzó la feature, infra tocó configuración, seguridad ajustó permisos, observabilidad subió el nivel de logs, y ahora el sistema no está exactamente caído. Está haciendo algo peor: está dando señales contradictorias.

### Slide debe mostrar

```text
23:55 — todo parece verde
00:00 — empieza Black Friday
00:03 — primeros reclamos
00:05 — dashboards ruidosos
00:08 — tracking atrasado
00:12 — sellers sin etiquetas
```

### Pregunta al aula

> ¿Qué les preocupa más: que el sistema esté caído o que parezca estar funcionando pero mienta?

### Participación

Chat rápido:

```text
A — Caído
B — Mentiroso
C — Depende del flujo
```

### Remate docente

> En SRE, “está up” no significa necesariamente “está bien”.

---

## 0:05–0:10 — Slide 2

# **La misión**

### Objetivo

Definir el problema.

### Docente dice

> La misión de hoy es recuperar control sobre un flujo crítico.
> No vamos a arreglar todo. No hay tiempo. En producción real tampoco hay tiempo para arreglar todo durante un incidente.
>
> Vamos a decidir qué protegemos, qué degradamos, qué revertimos y qué evidencia necesitamos para confiar.

### Slide debe mostrar

```text
Misión:
Proteger el journey crítico Order-to-Ship durante Black Friday.

Flujo:
pago aprobado
→ orden confirmada
→ fulfillment comprometido
→ shipment preparado
→ tracking visible
```

### Pregunta

> ¿Cuál de estos pasos creen que es más peligroso si falla silenciosamente?

Opciones:

```text
1. pago aprobado
2. orden confirmada
3. fulfillment comprometido
4. shipment preparado
5. tracking visible
```

### Comentario docente

> La trampa es que todos pueden ser peligrosos. Pero hoy vamos a buscar el punto donde el dolor del usuario y el dolor del negocio se vuelven observables.

---

## 0:10–0:15 — Slide 3

# **Reglas de la war room**

### Objetivo

Establecer dinámica de participación.

### Docente dice

> Reglas de hoy:
>
> 1. Primero síntoma, después causa.
> 2. Primero usuario, después CPU.
> 3. Nadie toca nada sin predicción.
> 4. No buscamos culpables, buscamos condiciones.
> 5. AWS es el laboratorio; la lección es agnóstica.
> 6. Si una demo falla, eso no rompe la clase: se convierte en otro incidente.

### Slide debe mostrar

```text
SRE GameDay loop:
Síntoma → Hipótesis → Predicción → Cambio → Evidencia → Decisión
```

### Participación

Preguntar:

> ¿Qué regla les parece más difícil de cumplir en una empresa real?

---

# Bloque 1 — SLO de emergencia

## 0:15–0:20 — Slide 4

# **Todos tienen razón, nadie tiene verdad**

### Objetivo

Introducir SLI/SLO desde la historia.

### Docente dice

> A las 00:08 pasa esto:
>
> Producto dice: “bajó la conversión”.
> Infra dice: “CPU rara, pero no crítica”.
> Backend dice: “mis endpoints responden”.
> Soporte dice: “los usuarios están furiosos”.
> Seguridad dice: “yo solo ajusté permisos”.
> Data dice: “mi job no debería molestar”.
>
> ¿Quién tiene razón? Probablemente todos.
> ¿Quién tiene una verdad operativa? Nadie todavía.

### Slide debe mostrar

```text
CPU alta ≠ necesariamente dolor de usuario
HTTP 200 ≠ necesariamente compra exitosa
orden creada ≠ necesariamente compra cumplible
tracking visible ≠ necesariamente verdad interna
```

### Pregunta al aula

> ¿Qué métrica representa mejor el dolor del comprador?

Opciones:

```text
A. CPU promedio
B. cantidad de requests HTTP 200
C. pagos aprobados que llegan a tracking visible en menos de X tiempo
D. número de logs por minuto
```

### Respuesta esperada

C.

### Docente remata

> Las métricas técnicas sirven para diagnosticar. No deberían ser automáticamente el volante del incidente.

---

## 0:20–0:27 — Slide 5

# **SLO de emergencia**

### Objetivo

Definir el SLO que guiará toda la clase.

### Docente dice

> Durante un evento crítico, no siempre podemos definir el SLO perfecto. Pero necesitamos un SLO suficientemente bueno para decidir.
>
> Propongo este SLO de emergencia para la clase:

### Slide

```text
SLO de emergencia:

Durante la ventana crítica,
95% de pagos aprobados deben llegar a un estado visible
para el comprador en menos de 2 minutos,
sin duplicar orden
y sin vender stock inexistente.
```

### Descomposición

```text
SLI 1: tiempo pago aprobado → tracking visible
SLI 2: duplicados de orden
SLI 3: stock/fulfillment inconsistente
SLI 4: freshness del tracking
```

### Pregunta

> ¿Qué tiene de bueno este SLO? ¿Qué tiene de malo?

### Respuestas esperadas

Bueno:

* habla de usuario;
* conecta servicios;
* incluye tiempo;
* incluye correctness.

Malo:

* difícil de medir;
* mezcla varias condiciones;
* para producción real habría que separarlo mejor.

### Docente dice

> Perfecto. Un SLO imperfecto explícito suele ser mejor que veinte dashboards perfectos sin decisión.

---

## 0:27–0:30 — Slide 6

# **Severidad**

### Objetivo

Declarar incidente.

### Docente dice

> Declaramos incidente. No porque todo esté caído, sino porque el flujo crítico de compra no es confiable.
>
> Severidad para la clase: SEV-2. Alto impacto, sistema parcialmente funcional, requiere coordinación inmediata.

### Slide

```text
SEV-2 didáctico:
- flujo crítico degradado
- usuarios afectados
- negocio afectado
- no hay pérdida total del sistema
- requiere war room
```

### Pregunta

> ¿Qué sería SEV-1 en esta historia?

Respuesta esperada:

* pagos aprobados sin órdenes;
* órdenes duplicadas masivas;
* venta de stock inexistente masiva;
* checkout completamente caído;
* imposibilidad de saber qué compras son válidas.

---

# Bloque 2 — Repo, roles y despliegue

## 0:30–0:35 — Slide 7

# **Descarga del repo**

### Objetivo

Bajar el repo y alinear a todos.

### Docente dice

> Ahora vamos al laboratorio.
> Los tres voluntarios van a operar partes distintas. El resto puede bajar el repo para seguir la estructura, leer los contratos y mirar los runbooks, pero no necesitamos que todos desplieguen.

### Slide

```bash
git clone https://github.com/<org>/<repo-mercadofuego-lab>.git
cd <repo-mercadofuego-lab>
make doctor
```

### Docente aclara

> `make doctor` no arregla nada. Solo verifica que el entorno mínimo esté razonable: herramientas, credenciales, región, contexto, variables necesarias.

### Acción

* Todos bajan el repo.
* Voluntarios comparten pantalla o alternan pantalla.
* Docente verifica que los tres voluntarios estén listos.

### Fallback

Si alguien no puede bajar el repo:

> Seguí desde el navegador o desde el documento del repo. Tu rol en la war room sigue siendo igual de importante.

---

## 0:35–0:40 — Slide 8

# **Asignación de equipos**

### Objetivo

Dejar claro quién despliega qué.

### Slide

```text
Voluntario A — Checkout / Order Team
- entrada de pagos
- orden confirmada
- errores/latencia de entrada

Voluntario B — Fulfillment / Shipping Team
- compromiso de fulfillment
- shipment
- documentos/etiquetas

Voluntario C — SRE / Buyer Experience Team
- tracking visible
- observabilidad
- SLO
- tablero de incidente
```

### Docente dice

> Cada equipo tiene ownership.
> Si algo falla entre ustedes, no lo tratamos como “el lab no anda”. Lo tratamos como un problema de contrato entre equipos.

### Pregunta al aula

> ¿Qué contrato mínimo tiene que existir entre estos equipos?

Respuestas esperadas:

* eventos;
* correlation_id;
* estado esperado;
* errores;
* ownership;
* outputs;
* endpoints;
* permisos;
* tiempos esperados.

---

## 0:40–0:47 — Slide 9

# **Deploy inicial: producción heredada**

### Objetivo

Desplegar el estado inicial, que no es sano sino “post-cambios”.

### Docente dice

> Ojo con esto: no vamos a desplegar una versión limpia.
> Vamos a desplegar la producción heredada después de que varios equipos tocaron cosas.
>
> En el repo esto puede aparecer como `blackfriday-broken`, `scenario=incident`, `v2`, o el nombre que terminemos usando. Narrativamente: es la versión que llegó a producción.

### Slide

```bash
# Voluntario A
make deploy-checkout SCENARIO=blackfriday-broken

# Voluntario B
make deploy-fulfillment-shipping SCENARIO=blackfriday-broken

# Voluntario C
make deploy-tracking-sre SCENARIO=blackfriday-broken
```

### Posibles acciones internas

No hace falta decirlas como implementación principal, pero pueden estar en speaker notes:

```text
SERVICE_VERSION=v2
ERROR_RATE=...
TIMING_90_PERCENTILE=...
RATE_LIMIT=...
SQS_PUBLISH_FAILURE_MODE=...
CPU_BURN_ENABLED=...
MEMORY_PRESSURE_ENABLED=...
VERBOSE_LOGGING=true
```

### Participación del aula

Mientras los voluntarios despliegan, el aula responde por chat:

> ¿Qué puede salir mal cuando tres equipos despliegan cambios cerca de Black Friday?

Capturar respuestas:

* permisos;
* escalado;
* dependencia nueva;
* falta de rollback;
* métricas equivocadas;
* cambios simultáneos;
* cola/backlog;
* costos;
* logs ruidosos.

### Fallback

Si el deploy tarda:

Docente dice:

> Mientras despliega, no miremos barras de progreso como zombies. Miremos el mapa de riesgo.

Mostrar slide auxiliar:

```text
Cambios sospechosos:
1. Promesa Express activa
2. workers modificados
3. permisos endurecidos
4. logging aumentado
5. rate limit cambiado
```

---

## 0:47–0:52 — Slide 10

# **Health check no es confianza**

### Objetivo

Mostrar que “verde” no alcanza.

### Comandos sugeridos

```bash
make health-check
make readiness-check
make version
```

### Docente dice

> Vamos a ver health checks. Pero quiero que lo digamos explícitamente: un health check verde no prueba que el journey de compra esté sano.

### Slide

```text
/healthz verde:
el proceso vive

/readyz verde:
el servicio cree estar listo

SLO verde:
el usuario recibe una experiencia aceptable

No son lo mismo.
```

### Pregunta

> ¿Qué puede estar roto aunque `/healthz` devuelva OK?

Respuestas esperadas:

* downstream;
* permisos;
* lógica de negocio;
* latencia;
* eventos;
* tracking;
* stock;
* colas acumuladas;
* documentos;
* duplicados.

---

# Bloque 3 — Happy path sospechoso

## 0:52–1:00 — Slide 11

# **Primera compra: el caso que engaña**

### Objetivo

Probar una compra end-to-end y evitar falsa confianza.

### Docente dice

> Vamos a simular una compra.
> No porque una compra exitosa pruebe confiabilidad, sino porque necesitamos una línea base narrativa: cómo debería verse el sistema cuando no está gritando.

### Comando sugerido

```bash
make simulate-payment ORDER=bf-001
```

o:

```bash
curl -X POST "$CHECKOUT_URL/internal/payments/approved" \
  -H "Content-Type: application/json" \
  -d @examples/payment-approved-bf-001.json
```

### Resultado esperado narrativo

```text
PAYMENT_APPROVED
→ ORDER_CONFIRMED
→ FULFILLMENT_COMMITTED
→ SHIPMENT_READY
→ BUYER_TRACKING_UPDATED
```

### Voluntarios

* A muestra que la orden fue aceptada.
* B muestra que fulfillment/shipment procesó.
* C muestra tracking visible y correlation_id.

### Aula

Antes de ejecutar:

> Predicción: ¿creen que el primer caso va a funcionar?

Votación:

```text
A. Sí, pero no prueba nada
B. No, ya arranca roto
C. Va a funcionar parcialmente
```

### Docente remata

> Si funciona, no celebramos demasiado. Si falla, tampoco nos sorprendemos. En SRE, un dato aislado nunca es la historia completa.

---

## 1:00–1:05 — Slide 12

# **Correlation ID: la cuerda que evita perdernos**

### Objetivo

Introducir evidencia end-to-end.

### Docente dice

> En un sistema distribuido, el usuario dice “mi compra falló”.
> Nosotros necesitamos convertir eso en una historia reconstruible.
>
> Para eso necesitamos una cuerda que atraviese servicios: correlation_id.

### Slide

```json
{
  "correlation_id": "checkout_bf_001",
  "payment_id": "pay_bf_001",
  "order_id": "ord_bf_001",
  "event": "orders.order_confirmed.v1",
  "service": "order-management"
}
```

### Acción

Voluntario C ejecuta:

```bash
make trace-order CORRELATION_ID=checkout_bf_001
```

o muestra logs filtrados.

### Pregunta

> Si no tuviéramos correlation_id, ¿qué haríamos durante el incidente?

Respuesta esperada:

* buscar por timestamp;
* buscar por payment_id;
* comparar logs manualmente;
* sufrir;
* inventar hipótesis débiles.

### Docente remata

> Sin evidencia, el incidente se llena de opiniones.

---

# Bloque 4 — Primer incidente: Promesa Express

## 1:05–1:10 — Slide 13

# **La feature que quería ayudar**

### Objetivo

Activar tensión producto vs confiabilidad.

### Docente dice

> La nueva feature se llama Promesa Express.
> Producto la ama porque mejora conversión.
> Marketing la puso en banners.
> Legal preguntó poco.
> Ingeniería dijo “en staging andaba”.
>
> Pero Black Friday no es staging con luces lindas.

### Slide

```text
Promesa Express:
“Comprá ahora y llega mañana”

Beneficio:
+ conversión
+ experiencia percibida
+ diferenciación comercial

Costo oculto:
+ latencia
+ dependencia extra
+ más presión sobre fulfillment
+ más estados visibles que pueden mentir
```

### Pregunta

> ¿Promesa Express es parte del flujo crítico o es una feature degradable?

Votación:

```text
A. Crítica, no se apaga
B. Degradable, se puede apagar
C. Depende de sellers/productos
D. No sabemos todavía
```

Respuesta deseada:

> Depende, pero durante incidente probablemente debe poder degradarse.

---

## 1:10–1:18 — Slide 14

# **Inyección de falla: Promesa Express v2**

### Objetivo

Mostrar degradación por feature nueva.

### Docente dice

> Vamos a simular que Promesa Express v2 está activa.
> En implementación esto puede ser una env var, una versión nueva, un cambio de config o un target del Makefile.
> Narrativamente: producto activó una feature que mete más latencia y algunos errores en el camino crítico.

### Comando sugerido

```bash
make feature-promesa-express-on
```

Equivalente conceptual:

```bash
# Ejemplo conceptual, no necesariamente comando final
kubectl set env deployment/transaction-api \
  SERVICE_VERSION=v2 \
  TIMING_90_PERCENTILE=2s \
  TIMING_99_PERCENTILE=8s \
  TIMING_VARIANCE=30 \
  ERROR_RATE=2 \
  ERROR_CODE=500
```

### Acción

Ejecutar carga liviana:

```bash
make load-test-small
```

o:

```bash
make simulate-payments COUNT=20
```

### Antes de ejecutar, pregunta

> ¿Qué esperamos que pase con nuestro SLO de emergencia?

Opciones:

```text
A. baja el éxito end-to-end
B. sube latencia
C. tracking queda atrasado
D. todo lo anterior
```

### Evidencia a mostrar

* latencia p90/p99;
* errores;
* pagos aprobados sin tracking rápido;
* backlog si aplica;
* logs con `SERVICE_VERSION=v2`;
* tracking viejo.

### Docente dice

> Noten algo: esta feature no “rompe AWS”. Rompe una promesa de negocio usando recursos cloud perfectamente válidos.

---

## 1:18–1:25 — Slide 15

# **Decisión: apagar, degradar o escalar**

### Objetivo

Forzar decisión imperfecta.

### Slide

```text
Opciones:
A. Mantener Promesa Express y escalar
B. Apagar Promesa Express
C. Degradarla: promesa genérica durante pico
D. Mantenerla solo para sellers confiables
E. No tocar nada hasta entender más
```

### Docente pregunta

> ¿Qué decisión toman como war room?
> Tienen que defenderla en una frase.

### Dinámica

* Chat vota A/B/C/D/E.
* 2 alumnos defienden opciones opuestas.
* Docente modera.

### Guía de discusión

Preguntas incómodas:

> ¿Escalar resuelve la causa o compra tiempo?
> ¿Apagar la feature reduce conversión o salva checkout?
> ¿Qué le decimos a producto?
> ¿Por cuánto tiempo aceptamos degradarla?
> ¿Cómo sabemos si mejoró?

### Decisión recomendada para el guion

Elegir:

```text
C. Degradar Promesa Express a promesa genérica
```

Motivo:

* no bloquea compra;
* reduce latencia;
* mantiene experiencia razonable;
* permite reactivar luego.

### Comando de cura

```bash
make feature-promesa-express-degrade
```

o:

```bash
make feature-promesa-express-off
```

Conceptualmente:

```bash
kubectl set env deployment/transaction-api \
  SERVICE_VERSION=v1 \
  ERROR_RATE- \
  ERROR_CODE- \
  TIMING_50_PERCENTILE- \
  TIMING_90_PERCENTILE- \
  TIMING_99_PERCENTILE- \
  TIMING_VARIANCE-
```

### Done de etapa

```text
[ ] Decidimos si la feature era crítica o degradable.
[ ] Aplicamos mitigación.
[ ] Medimos contra el SLO, no contra intuición.
[ ] Declaramos el riesgo: menor precisión/promesa comercial.
```

### Frase de cierre

> La primera cura SRE no fue “más infraestructura”. Fue matar una dependencia no esencial.

---

# Bloque 5 — Pausa corta

## 1:25–1:35

### Docente dice

> Cinco a diez minutos de pausa. Cuando volvemos, el problema deja de ser solo una feature. Vamos a descubrir que también hubo cambios de infraestructura. Porque producción nunca se incendia con un solo fósforo prolijo.

Durante la pausa, dejar visible una slide con:

```text
Volvemos con:
- timeline del incidente
- cambios simultáneos
- rollback selectivo
- backlog
- permisos
```

---

# Bloque 6 — Segundo incidente: cambios simultáneos de infra

## 1:35–1:40 — Slide 16

# **Rollback de qué, si cambiaron cinco cosas**

### Objetivo

Introducir timeline como herramienta SRE.

### Docente dice

> Volvemos. La feature fue degradada y algo mejoró, pero no todo.
> Ahora aparece lo típico: alguien pregunta “¿qué cambió?”.
> Y la respuesta es el infierno: “varias cosas, pero todas eran seguras”.

### Slide

```text
Timeline preliminar:

23:20 — Infra ajusta workers/concurrencia
23:35 — Seguridad endurece permisos
23:40 — Observabilidad sube logging
23:50 — Producto activa Promesa Express
00:00 — Arranca Black Friday
00:03 — Primeros reclamos
00:08 — Backlog
00:12 — Tracking atrasado
00:15 — Sellers reportan etiquetas faltantes
```

### Pregunta

> ¿Qué cambio revertimos primero?

Opciones:

```text
A. workers/concurrencia
B. permisos
C. logging
D. Promesa Express
E. ninguno, solo observar
```

### Docente remata

> Sin timeline, el rollback es superstición con permisos de producción.

---

## 1:40–1:48 — Slide 17

# **El sistema no cae: se atrasa**

### Objetivo

Mostrar backlog y diferencia entre “up” y “cumpliendo SLO”.

### Storytelling

> Después de degradar Promesa Express, la entrada acepta más compras. Pero fulfillment y shipping no siguen el ritmo.
>
> Desde afuera parece que el checkout vive. Desde adentro, el trabajo se acumula.
>
> El sistema no cayó. Se atrasó. Y para el comprador, eso también puede ser falla.

### Comandos sugeridos

```bash
make show-queues
make show-slo
make simulate-payments COUNT=50
```

o activar falla de infra:

```bash
make fault-workers-too-slow-on
```

Conceptual:

```bash
# Ejemplo conceptual
kubectl set env deployment/fulfillment-worker \
  CPU_BURN_ENABLED=true \
  CPU_BURN_PERCENT=80

kubectl set env deployment/transaction-api \
  RATE_LIMIT=5 \
  RATE_LIMIT_CODE=503
```

### Evidencia

Mostrar algo como:

```text
payments accepted: 50
orders confirmed: 45
fulfillment committed: 21
shipment ready: 10
tracking updated: 9
queue depth: growing
p95 journey time: above SLO
```

### Pregunta

> ¿Qué es peor ahora: aceptar más compras o frenar entrada?

### Opciones

```text
A. aceptar todo y procesar después
B. rate limit temporal
C. priorizar órdenes ya pagadas
D. escalar workers
E. apagar features no críticas
```

### Discusión esperada

* aceptar todo puede crear deuda operativa;
* rate limiting protege downstream pero afecta conversión;
* escalar cuesta y puede no resolver si hay DB bottleneck;
* priorizar eventos críticos es más SRE;
* apagar features no críticas libera capacidad.

---

## 1:48–1:55 — Slide 18

# **Backpressure: decir que no también es confiabilidad**

### Objetivo

Introducir backpressure y degradación controlada.

### Docente dice

> Una idea incómoda: a veces la respuesta responsable no es “aceptar todo”.
> A veces confiabilidad significa rechazar, demorar o degradar antes de mentir.

### Slide

```text
Opciones de contención:

1. Escalar workers
2. Limitar entrada
3. Priorizar órdenes pagadas
4. Degradar Promesa Express
5. Reducir logs ruidosos
6. Enviar a cola / diferir trabajo no crítico
```

### Decisión recomendada

Elegir combinación:

```text
- Promesa Express degradada
- priorizar órdenes ya pagadas
- reducir logging ruidoso
- ajustar workers a configuración segura
```

### Comandos de cura

```bash
make fault-workers-too-slow-off
make observability-noise-reduce
make apply-safe-worker-config
make load-test-small
make show-slo
```

### Done de etapa

```text
[ ] Identificamos backlog.
[ ] No confundimos “servicio vivo” con “SLO sano”.
[ ] Elegimos contención.
[ ] Medimos impacto.
[ ] Declaramos riesgo residual.
```

### Frase docente

> Escalar sin entender puede convertir un incidente técnico en un incidente técnico más caro.

---

# Bloque 7 — Tercer incidente: permisos y shipment bloqueado

## 1:55–2:00 — Slide 19

# **Seguridad hizo lo correcto… casi**

### Objetivo

Introducir IAM/permisos sin convertirlo en clase de seguridad.

### Docente dice

> Ahora aparece otro síntoma.
> Fulfillment logra comprometer algunas órdenes, pero sellers reportan que no pueden despachar.
>
> El sistema crea shipment parcialmente, pero no genera o no guarda documentos.
> Seguridad dice: “yo solo apliqué least privilege”.
>
> Y probablemente tenía buenas intenciones. El problema es que buenas intenciones también rompen producción.

### Slide

```text
Síntoma:
- order confirmed
- fulfillment committed
- shipment partial
- label/document unavailable
- buyer tracking at-risk
```

### Pregunta

> ¿Esto es una falla de negocio, de permisos, de storage o de observabilidad?

Respuesta:

> Puede verse como negocio, pero la causa probable puede ser permiso/config/storage. El síntoma igual es de negocio: el seller no puede despachar.

---

## 2:00–2:08 — Slide 20

# **Falla controlada: documentos bloqueados**

### Objetivo

Diagnosticar y decidir mitigación.

### Comando sugerido

```bash
make fault-shipment-documents-blocked-on
make simulate-payment ORDER=bf-docs-001
make trace-order ORDER=bf-docs-001
```

Si se usa la variable existente como referencia:

```bash
make fault-sqs-publish-failure-on
```

Conceptual:

```bash
kubectl set env deployment/transaction-api \
  SQS_PUBLISH_FAILURE_MODE=true
```

O para IAM/S3 cuando exista:

```bash
make fault-s3-putobject-denied-on
```

### Evidencia esperada

```text
shipping.dispatch_blocked.v1
AccessDenied / publish failure / document unavailable
tracking: DISPATCH_BLOCKED
SLO document availability degraded
```

### Docente pregunta

> Durante un incidente, ¿aceptarían un permiso más amplio durante 30 minutos?

Opciones:

```text
A. Sí, si queda registrado y expira
B. No, nunca
C. Sí, pero solo con blast radius acotado
D. Depende del impacto de negocio
```

### Discusión

Guiar hacia:

> La pregunta no es “permiso amplio sí/no”.
> La pregunta profesional es: ¿qué riesgo acepto, por cuánto tiempo, con qué evidencia, con qué rollback y con qué blast radius?

---

## 2:08–2:15 — Slide 21

# **Cura: fix mínimo o permiso temporal**

### Objetivo

Aplicar mitigación y registrar riesgo.

### Decisión recomendada

```text
Aplicar fix mínimo si está disponible.
Si no, permiso temporal acotado con rollback explícito.
```

### Comando de cura

```bash
make fault-shipment-documents-blocked-off
make apply-shipment-permission-fix
make simulate-payment ORDER=bf-docs-002
make trace-order ORDER=bf-docs-002
```

### Slide

```text
Mitigación aceptable:
- acotada
- reversible
- observable
- registrada
- con owner
- con expiración o cleanup
```

### Done de etapa

```text
[ ] Detectamos que el shipment estaba bloqueado.
[ ] No confundimos síntoma de negocio con causa técnica.
[ ] Aplicamos mitigación.
[ ] Registramos riesgo.
[ ] Verificamos que shipment/documento vuelva a estar disponible.
```

### Frase docente

> Least privilege no es pegarle a producción con una regla y rezar. Es diseñar permisos correctos, verificables y operables.

---

# Bloque 8 — Tracking viejo: el comprador ve una mentira

## 2:15–2:20 — Slide 22

# **La verdad interna y la verdad visible**

### Objetivo

Trabajar experiencia de usuario y read model.

### Docente dice

> El core puede estar avanzando y el comprador igual puede estar viendo una mentira vieja.
>
> En un marketplace, el estado visible no es un detalle cosmético. Es parte de la confiabilidad percibida.
>
> Si el comprador pagó y no ve nada, compra dos veces, abre reclamo o pierde confianza.

### Slide

```text
Internamente:
ORDER_CONFIRMED
FULFILLMENT_COMMITTED
SHIPMENT_READY

Comprador ve:
"Estamos procesando tu compra..."
desde hace 12 minutos
```

### Pregunta

> ¿Un sistema que procesa bien pero informa mal está sano?

Respuesta esperada:

> No completamente. Desde el usuario, el sistema está degradado.

---

## 2:20–2:28 — Slide 23

# **Tracking freshness**

### Objetivo

Medir freshness como SLI.

### Acción

```bash
make show-tracking ORDER=bf-001
make show-tracking-freshness
make trace-order ORDER=bf-001
```

Activar si hace falta:

```bash
make fault-tracking-lag-on
```

Conceptual:

```bash
kubectl set env deployment/buyer-tracking \
  TIMING_90_PERCENTILE=5s \
  TIMING_99_PERCENTILE=20s
```

o detener consumidor:

```bash
make pause-tracking-consumer
```

### Evidencia esperada

```text
last_internal_event: shipping.shipment_ready_to_dispatch.v1
buyer_visible_status: ORDER_CONFIRMED
freshness_lag_seconds: 180
SLO: breached
```

### Pregunta

> ¿Qué estado deberíamos mostrar si no estamos seguros?

Opciones:

```text
A. el último estado confirmado
B. un estado “en actualización”
C. ocultar detalle
D. mostrar estado optimista
```

### Discusión

Punto clave:

> El estado visible también es una promesa. Si no sabemos, no deberíamos fingir certeza.

---

## 2:28–2:35 — Slide 24

# **Cura: estado honesto y evidencia**

### Objetivo

Aplicar cura o decisión de tracking.

### Decisión recomendada

```text
- priorizar eventos de tracking críticos
- reducir lag
- mostrar estado honesto si hay incertidumbre
- mantener timeline reconstruible
```

### Comandos

```bash
make fault-tracking-lag-off
make prioritize-tracking-events
make replay-tracking-events ORDER=bf-001
make show-tracking ORDER=bf-001
```

### Done de etapa

```text
[ ] Diferenciamos estado interno y visible.
[ ] Medimos freshness.
[ ] Reconstruimos con correlation_id.
[ ] Evitamos mostrar una mentira optimista.
[ ] Mejoramos tracking para el flujo crítico.
```

### Frase docente

> A veces el usuario no necesita todos los detalles. Pero sí necesita que el sistema no le mienta.

---

# Bloque 9 — Re-test del flujo crítico

## 2:35–2:42 — Slide 25

# **¿Volvimos a estar defendibles?**

### Objetivo

Validar estado después de mitigaciones.

### Docente dice

> Ahora vamos a repetir el flujo. No para declarar victoria absoluta.
> Para ver si el sistema volvió a estar defendible bajo el SLO que elegimos.

### Comandos

```bash
make simulate-payments COUNT=20
make show-slo
make show-queues
make show-errors
make show-tracking-summary
```

### Evidencia esperada

```text
order_to_tracking_under_2m_ratio: improved
duplicate_orders: 0
stock_inconsistencies: 0
dispatch_blocked: reduced/resolved
tracking_freshness_p95: improved
```

### Pregunta

> ¿El incidente está resuelto, mitigado o todavía activo?

Opciones:

```text
A. Resuelto
B. Mitigado
C. Activo
D. No sabemos
```

### Respuesta ideal

> Mitigado. Todavía falta postmortem, guardrails y verificación sostenida.

### Docente remata

> En SRE, “dejó de gritar” no siempre significa “terminó”.

---

## 2:42–2:47 — Slide 26

# **Riesgos que aceptamos**

### Objetivo

Hacer explícitos los trade-offs.

### Slide

```text
Decisiones tomadas:
- Promesa Express degradada
- workers/config estabilizados
- permisos/documentos corregidos
- tracking priorizado
- ruido reducido

Riesgos aceptados:
- promesa menos precisa
- menor conversión temporal
- algunas operaciones diferidas
- permisos temporales si aplicaron
- deuda de análisis post-incidente
```

### Pregunta

> ¿Cuál de estos riesgos es más incómodo de defender frente a negocio?

Dejar que 2 o 3 alumnos contesten.

### Docente dice

> Esta es la parte que la IA no firma por ustedes. Puede sugerir opciones, pero alguien humano tiene que hacerse cargo del riesgo aceptado.

---

# Bloque 10 — Postmortem de bolsillo

## 2:47–2:55 — Slide 27

# **No preguntamos “quién rompió producción”**

### Objetivo

Cierre SRE blameless y acción preventiva.

### Docente dice

> Ahora viene la pregunta tentadora:
>
> “¿Quién rompió producción?”
>
> Mala pregunta.
>
> La pregunta útil es:
>
> “¿Qué condiciones hicieron razonable que esto pasara?”

### Slide

```text
Nota de guardia:

Impacto:
Síntoma principal:
SLO degradado:
Cambios contribuyentes:
Mitigación aplicada:
Riesgo aceptado:
Acción preventiva:
Qué no repetiríamos:
```

### Actividad

Por chat, completar rápido.

Docente va tomando respuestas.

Ejemplo final:

```text
Impacto:
compradores con pagos aprobados no veían tracking confiable;
sellers no podían despachar algunas órdenes.

Síntoma principal:
journey pago → tracking superaba el SLO de 2 minutos.

SLO degradado:
order_to_tracking_under_2m_ratio.

Cambios contribuyentes:
Promesa Express,
workers/concurrencia,
permisos de shipment,
logging ruidoso,
falta de freeze.

Mitigación:
degradar Promesa Express,
estabilizar workers,
corregir permisos,
priorizar tracking,
reducir ruido.

Riesgo aceptado:
promesa logística menos precisa durante la ventana crítica.

Acción preventiva:
freeze antes de eventos,
feature flags obligatorios,
runbook de rollback,
SLO de journey antes de launch,
prueba de carga con Promesa Express.
```

### Pregunta final de discusión

> ¿Qué guardrail habría prevenido esto sin pedirle a la gente que sea perfecta?

Respuestas deseadas:

* freeze de cambios;
* feature flags;
* canary;
* rollback probado;
* SLO antes de launch;
* dashboards orientados a journey;
* límites de concurrencia;
* idempotencia;
* runbook;
* permisos testeados;
* game days previos.

---

# Bloque 11 — Cleanup y cierre

## 2:55–2:58 — Slide 28

# **Cleanup: también es parte de operar**

### Objetivo

Evitar costos y reforzar responsabilidad cloud.

### Docente dice

> En cloud, levantar recursos es fácil. Dejarlos olvidados también.
> Cleanup no es administración aburrida: es parte de operar responsablemente.

### Comandos

```bash
make cleanup-check
make destroy-checkout
make destroy-fulfillment-shipping
make destroy-tracking-sre
make cleanup-verify
```

o:

```bash
terraform destroy
```

### Checklist slide

```text
[ ] compute apagado/eliminado
[ ] bases eliminadas o en estado esperado
[ ] colas eliminadas
[ ] buckets vacíos/eliminados
[ ] tablas eliminadas
[ ] snapshots no deseados eliminados
[ ] no quedan load balancers / IPs / recursos cobrables
```

### Docente dice

> Si no llegamos a destruir todo en vivo, el repo debe tener un comando de cleanup claro y verificable. Pero idealmente lo hacemos ahora.

---

## 2:58–3:00 — Slide 29

# **Cierre**

### Docente dice

> Hoy usamos AWS, Terraform, servicios, eventos, colas, logs y fallas controladas.
> Pero la clase no fue sobre memorizar servicios.
>
> La clase fue sobre sostener una promesa de negocio cuando tráfico, cambios, deuda técnica y presión organizacional llegan todos juntos.
>
> Cloud no te salva de pensar. Cloud hace que tus decisiones se ejecuten más rápido, escalen más rápido y fallen más visiblemente.
>
> La responsabilidad del ingeniero es decidir qué sacrificar, qué medir y qué evidencia necesita para confiar.

### Frase final en slide

> **No construimos una demo de AWS. Recuperamos un flujo crítico usando AWS como laboratorio de decisiones.**

---

# 9. Guion alternativo si las demos fallan

Tenés que tener esto preparado para no perder la clase.

## Si falla el deploy inicial

Decís:

> Esto también es producción: el primer problema no siempre es el sistema, a veces es el entorno. No vamos a mirar Terraform durante 20 minutos. Pasamos al entorno de respaldo y seguimos con la decisión SRE.

Usás:

```text
fallback outputs
capturas
logs precargados
endpoint docente
recording corto
```

---

## Si falla un voluntario

Reasignación:

```text
Voluntario A falla:
docente usa endpoint predesplegado de checkout.

Voluntario B falla:
se usa fulfillment/shipping fallback.

Voluntario C falla:
tracking/logs se muestran desde dataset precargado.
```

Frase:

> Nadie queda expuesto. Esto no es una competencia de consola. Es una práctica de criterio.

---

## Si los comandos tardan

Activás discusión:

> Mientras esto corre, predicción obligatoria: ¿qué métrica debería moverse si nuestra hipótesis es correcta?

---

## Si todo funciona demasiado perfecto

Inyectás una falla más agresiva:

```bash
make fault-hard-mode-on
```

Conceptualmente:

```text
ERROR_RATE=10
RATE_LIMIT muy bajo
CPU burn alto
SQS publish failure
tracking consumer pausado
```

Frase:

> Producción escuchó que estábamos cómodos y decidió educarnos.

---

# 10. Puntos donde se baja y usa el repo

## Punto 1 — 0:30

Todos bajan repo.

```bash
git clone ...
cd ...
make doctor
```

Objetivo:

```text
orientarse
ver estructura
validar entorno
```

---

## Punto 2 — 0:40

Voluntarios despliegan.

```bash
make deploy-checkout SCENARIO=blackfriday-broken
make deploy-fulfillment-shipping SCENARIO=blackfriday-broken
make deploy-tracking-sre SCENARIO=blackfriday-broken
```

Objetivo:

```text
levantar producción heredada, ya contaminada por cambios
```

---

## Punto 3 — 0:52

Se prueba primera compra.

```bash
make simulate-payment
make trace-order
```

Objetivo:

```text
establecer camino feliz sospechoso
```

---

## Punto 4 — 1:10

Se activa Promesa Express o se evidencia que ya está activa.

```bash
make feature-promesa-express-on
make load-test-small
```

Objetivo:

```text
mostrar que una feature comercial puede degradar confiabilidad
```

---

## Punto 5 — 1:22

Se cura/degrada Promesa Express.

```bash
make feature-promesa-express-degrade
make show-slo
```

Objetivo:

```text
practicar graceful degradation
```

---

## Punto 6 — 1:40

Se muestra backlog / workers / rate limiting.

```bash
make show-queues
make fault-workers-too-slow-on
make simulate-payments COUNT=50
```

Objetivo:

```text
mostrar que up no significa sano
```

---

## Punto 7 — 1:52

Se aplica configuración segura.

```bash
make apply-safe-worker-config
make observability-noise-reduce
```

Objetivo:

```text
mitigar saturación y ruido
```

---

## Punto 8 — 2:00

Se muestra shipment bloqueado.

```bash
make fault-shipment-documents-blocked-on
make trace-order
```

Objetivo:

```text
mostrar permisos/config como falla de negocio
```

---

## Punto 9 — 2:10

Se corrige permiso/documentos.

```bash
make apply-shipment-permission-fix
make simulate-payment
```

Objetivo:

```text
recuperar despacho
```

---

## Punto 10 — 2:20

Se muestra tracking freshness.

```bash
make show-tracking-freshness
make replay-tracking-events
```

Objetivo:

```text
trabajar verdad visible para comprador
```

---

## Punto 11 — 2:35

Re-test end-to-end.

```bash
make simulate-payments COUNT=20
make show-slo
```

Objetivo:

```text
decidir si el incidente está mitigado
```

---

## Punto 12 — 2:55

Cleanup.

```bash
make cleanup-check
make destroy
make cleanup-verify
```

Objetivo:

```text
cerrar responsabilidad cloud
```

---

# 11. Mapa de slides sugerido

1. Black Friday en llamas
2. La misión
3. Reglas de la war room
4. Todos tienen razón, nadie tiene verdad
5. SLO de emergencia
6. Severidad
7. Descarga del repo
8. Asignación de equipos
9. Deploy inicial: producción heredada
10. Health check no es confianza
11. Primera compra: el caso que engaña
12. Correlation ID
13. La feature que quería ayudar
14. Promesa Express v2
15. Decisión: apagar, degradar o escalar
16. Rollback de qué, si cambiaron cinco cosas
17. El sistema no cae: se atrasa
18. Backpressure
19. Seguridad hizo lo correcto… casi
20. Documentos bloqueados
21. Cura: fix mínimo o permiso temporal
22. La verdad interna y la verdad visible
23. Tracking freshness
24. Cura: estado honesto y evidencia
25. ¿Volvimos a estar defendibles?
26. Riesgos que aceptamos
27. Postmortem de bolsillo
28. Cleanup
29. Cierre

---

# 12. Materiales que conviene preparar en el repo

Para que este guion funcione sin depender de improvisación, el repo debería tener algo así:

```text
README.md
docs/
  00-story.md
  01-war-room-board.md
  02-slo.md
  03-runbook.md
  04-incidents.md
  05-postmortem-template.md
  06-cleanup.md

examples/
  payment-approved-bf-001.json
  payment-approved-bf-duplicate.json
  payment-approved-stock-risk.json

scripts/
  doctor.sh
  simulate-payment.sh
  simulate-payments.sh
  trace-order.sh
  show-slo.sh
  show-queues.sh
  show-tracking.sh
  cleanup-verify.sh

Makefile
infra.mk
```

Targets ideales:

```bash
make doctor

make deploy-checkout
make deploy-fulfillment-shipping
make deploy-tracking-sre

make simulate-payment
make simulate-payments
make trace-order
make show-slo
make show-queues
make show-tracking
make show-tracking-freshness

make feature-promesa-express-on
make feature-promesa-express-degrade
make feature-promesa-express-off

make fault-workers-too-slow-on
make fault-workers-too-slow-off
make apply-safe-worker-config

make fault-shipment-documents-blocked-on
make apply-shipment-permission-fix

make fault-tracking-lag-on
make fault-tracking-lag-off
make replay-tracking-events

make observability-noise-on
make observability-noise-reduce

make cleanup-check
make destroy
make cleanup-verify
```

---

# 13. Variables de entorno como features narrativas

No conviene presentar las env vars como “miren este truquito”. Conviene mapearlas a decisiones de producto/infra.

| Variable / mecanismo       | Narrativa                                     |
| -------------------------- | --------------------------------------------- |
| `SERVICE_VERSION=v2`       | Promesa Express activada                      |
| `ERROR_RATE`               | feature nueva introduce errores intermitentes |
| `ERROR_CODE`               | tipo de falla percibida por usuario           |
| `ERROR_TYPE=delay`         | dependencia lenta antes de fallar             |
| `ERROR_DELAY`              | timeout o espera artificial                   |
| `TIMING_50_PERCENTILE`     | latencia normal modificada                    |
| `TIMING_90_PERCENTILE`     | cola larga / p90 degradado                    |
| `TIMING_99_PERCENTILE`     | outliers dolorosos                            |
| `TIMING_VARIANCE`          | jitter / comportamiento impredecible          |
| `RATE_LIMIT`               | protección o mala configuración de entrada    |
| `RATE_LIMIT_CODE`          | cómo se manifiesta el rechazo                 |
| `SQS_PUBLISH_FAILURE_MODE` | falla al publicar evento crítico              |
| `CPU_BURN_ENABLED`         | worker saturado por cambio de infra           |
| `MEMORY_PRESSURE_ENABLED`  | memory pressure / leak simulado               |
| `VERBOSE_LOGGING`          | observabilidad ruidosa y costosa              |

Mensaje para alumnos:

> Técnicamente son env vars. Operativamente son cambios de producción. Pedagógicamente son decisiones con consecuencias.

---

# 14. Preguntas provocadoras para insertar durante la clase

Podés usarlas cuando necesites levantar energía.

```text
¿CPU alta es un incidente si los usuarios todavía compran?

¿Qué es peor: rechazar una compra o aceptar una compra que no podés cumplir?

¿Una feature que aumenta conversión merece seguir activa si degrada checkout?

¿Escalar arregla el incidente o solo lo vuelve más caro?

¿Un sistema que procesa bien pero informa mal está sano?

¿Durante un incidente aceptarías un permiso más amplio por 30 minutos?

¿Rollback de qué, si cambiaron cinco cosas?

¿Qué métrica apagarías porque solo genera ruido?

¿Qué riesgo firmarías con tu nombre?

¿Qué guardrail evita depender de héroes?
```

---

# 15. Cierre conceptual para reforzar

Al final, el aprendizaje debería quedar así:

```text
Cloud Computing:
no es solo usar servicios gestionados;
es operar sistemas con elasticidad, medición, permisos, costos y fallas parciales.

AWS:
fue el terreno de juego, no el objetivo final.

Terraform/IaC:
no fue solo crear recursos;
fue hacer cambios auditables, repetibles y reversibles.

SRE:
no fue mirar dashboards;
fue definir una promesa, medir dolor, mitigar, degradar y aprender.

Arquitectura:
no fue dibujar cajitas;
fue decidir qué parte del sistema podía fallar sin destruir el flujo crítico.
```

Frase final recomendada:

> **La nube te deja mover rápido. SRE te obliga a preguntar si moverte rápido está salvando el negocio o incendiándolo con más estilo.**
