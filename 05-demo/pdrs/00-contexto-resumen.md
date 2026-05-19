# Consolidado V3 sobre V2 - 00-contexto-resumen

> Estado: V3 aplicado como base actual. El detalle de V2 queda preservado debajo para evitar perdida de contenido durante la mezcla.

## Base V3 actual

# PDR v3 — CompraFiubi Black Friday SRE GameDay

**Versión:** 3.0
**Contexto:** clase/taller de Cloud Computing aplicada, FIUBA, quinto año Ingeniería en Informática
**Formato:** war room SRE + despliegue colaborativo en AWS con Terraform
**Duración objetivo:** aproximadamente 3 horas
**Audiencia:** alumnos avanzados, algunos con experiencia industrial
**Caso de uso:** marketplace ficticio estilo MercadoLibre, sin afirmar ni sugerir que esta sea arquitectura interna real de ninguna empresa
**Tono:** humorístico controlado, técnicamente serio
**Nombre de empresa ficticia:** `CompraFiubi`
**Evento:** Black Friday
**Restricción principal:** máximo 4 microservicios desplegables
**Arquitectura conceptual:** saga coreografiada, event-driven, database-per-service conceptual, AWS-first lab
**Enfoque pedagógico:** incidente-first / SRE-first, no AWS 101

---

## 1. Resumen ejecutivo

Esta clase deja de ser un recorrido lineal por servicios AWS y pasa a ser una experiencia de operación bajo presión.

Durante Black Friday, `CompraFiubi`, un marketplace ficticio, empieza la noche con el sistema ya degradado. La campaña acaba de arrancar, el tráfico sube, una feature comercial nueva fue activada, varios equipos tocaron infraestructura casi al mismo tiempo y los dashboards iniciales no cuentan una historia clara.

La clase entra como **war room SRE**. Los alumnos no vienen a “ver AWS”. Vienen a recuperar control sobre un flujo crítico de negocio:

```text
payment approved
→ order confirmed
→ fulfillment committed
→ shipment ready
→ buyer tracking updated
```

El sistema no está completamente caído. Peor: responde de forma parcial, se atrasa, a veces miente, y no queda claro qué métrica representa el dolor real del usuario.

La misión de la clase es restaurar una versión defendible del flujo Order-to-Ship, aplicando prácticas SRE: definir SLO de emergencia, separar síntomas de causas, leer evidencia, elegir mitigaciones, degradar features no críticas, corregir configuración, aplicar rollback o fix mínimo y cerrar con una nota de guardia.

El objetivo no es que los alumnos memoricen servicios AWS. El objetivo es que puedan defender decisiones como:

```text
¿Qué flujo salva el negocio?
¿Qué métrica representa dolor real del comprador?
¿Qué cambio revertimos primero?
¿Qué feature degradamos?
¿Cuándo escalar ayuda y cuándo solo hace más caro el problema?
¿Qué evidencia necesitamos para confiar en el sistema?
¿Qué guardrail evita depender de héroes la próxima vez?
```

---

## 2. Principio rector de la clase

La clase se organiza alrededor de una pregunta madre:

> **¿Qué estamos dispuestos a sacrificar para que la compra todavía sea confiable?**

Esta versión evita una frase demasiado genérica o “de IA”, y la vuelve más SRE:

```text
No buscamos que todo funcione.
Buscamos proteger la promesa crítica del sistema bajo presión.
```

La clase debe reforzar esta idea:

> Un sistema puede estar “up” y aun así estar rompiendo la promesa al usuario.

---

## 3. Cambio respecto de versiones anteriores

La versión anterior del PDR era arquitectura-first:

```text
Diseñamos Order-to-Ship
→ desplegamos servicios
→ probamos happy path
→ inyectamos incidentes
```

La versión 3 es incidente-first:

```text
Black Friday ya empezó
→ el sistema está degradado
→ definimos SLO de emergencia
→ desplegamos/activamos piezas heredadas
→ observamos síntomas
→ aplicamos curas SRE
→ cerramos con evidencia y postmortem liviano
```

La arquitectura sigue existiendo, pero ya no es “la solución bonita”. Es el escenario donde se ven las consecuencias de malas decisiones técnicas y organizacionales.

---

## 4. Supuestos cerrados para V3

Estas decisiones se toman para avanzar. Pueden cambiar en V4, pero V3 queda consistente con ellas.

| Decisión                     | V3 toma esta posición                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Empresa ficticia             | `CompraFiubi`                                                                               |
| Evento                       | Black Friday                                                                                |
| Tono                         | Humorístico controlado                                                                      |
| Inicio de la historia        | El sistema ya arranca degradado                                                             |
| Formato                      | War room SRE                                                                                |
| IA como tema                 | No es protagonista; el rediseño ya evita AWS 101                                            |
| Runtime                      | EC2 con Docker containers                                                                   |
| IaC                          | Terraform activo, no solo decorativo                                                        |
| Observabilidad               | Prometheus/Grafana/Alertmanager del docente como tablero principal                          |
| CloudWatch                   | No es tablero principal; opcional como soporte/log de AWS                                   |
| Microservicios               | 4 microservicios reales creados por el docente                                              |
| Lenguajes                    | NestJS/TypeScript y Go                                                                      |
| Cuentas AWS                  | Cada voluntario usa su propia cuenta                                                        |
| Integración entre cuentas    | V3 base evita cross-account IAM complejo                                                    |
| Comunicación entre servicios | HTTP entre servicios + SQS local por servicio/cuenta para simular asincronía y backpressure |
| Cross-account SQS            | Extensión avanzada, no base                                                                 |
| RDS                          | PostgreSQL real para servicios transaccionales, con cuidado de costo/cleanup                |
| DynamoDB                     | Real para buyer tracking                                                                    |
| S3                           | Real para documentos/etiquetas de despacho                                                  |
| Load balancer                | Fuera de scope base                                                                         |
| NAT Gateway                  | Fuera de scope base                                                                         |
| Route 53                     | Fuera de scope base                                                                         |
| ECR                          | Fuera de scope base si se usan imágenes públicas o prepublicadas                            |
| VPC                          | Default VPC, no eje pedagógico                                                              |
| Pausa                        | No hay pausa formal                                                                         |
| Evaluación                   | No hay evaluación formal                                                                    |
| Cierre                       | Nota de guardia / postmortem liviano                                                        |

---

## 5. Objetivo pedagógico

Que los alumnos entiendan Cloud Computing como práctica de arquitectura y operación bajo restricciones, usando AWS como plataforma concreta.

La clase debe llevarlos a discutir y experimentar:

```text
SLOs y SLIs centrados en usuario
war room / incident response
degradación controlada
rollback / fix mínimo
backpressure
colas y asincronía
idempotencia
IAM como causa real de incidente
observabilidad útil vs ruido
infraestructura como código
trade-offs de costo, seguridad, confiabilidad y operación
```

La clase no debe convertirse en:

```text
una explicación lineal de EC2/SQS/RDS/S3/DynamoDB/IAM
una demo donde los alumnos solo miran
un laboratorio perfecto donde nada falla
un curso de seguridad cloud
una clase de Kubernetes/ECS/EKS
una discusión abstracta sin AWS real
```

---

## 6. Marco SRE de la clase

La clase usa SRE como metodología práctica, no como teoría aislada.

| Momento narrativo                   | Herramienta SRE             |
| ----------------------------------- | --------------------------- |
| “No sabemos si estamos mal”         | SLI/SLO de emergencia       |
| “Todos miran métricas distintas”    | Métrica centrada en usuario |
| “Hay muchos cambios simultáneos”    | Timeline del incidente      |
| “La feature rompe el flujo crítico” | Graceful degradation        |
| “No sabemos qué revertir”           | Rollback discipline         |
| “El sistema no cae, se atrasa”      | Backpressure / queueing     |
| “Un mensaje llega dos veces”        | Idempotencia                |
| “Un permiso rompe shipment”         | Blast radius / fix mínimo   |
| “El comprador ve estado viejo”      | User-facing reliability     |
| “Se calmó el fuego”                 | Postmortem sin culpa        |

---


---

## Detalle V2 conservado

# PDR v2 — Black Friday SRE GameDay: Order-to-Ship Marketplace Lab

**Versión:** 2.0
**Contexto:** clase de Cloud Computing aplicada como war room SRE
**Caso de uso:** marketplace ficticio `MercadoFuego`, inspirado en marketplaces tipo MercadoLibre, sin afirmar ni sugerir que esta sea su arquitectura interna real
**Evento:** Black Friday / Hot Sale
**Feature problemática:** `Promesa Express`
**Restricción principal:** máximo **4 microservicios** desplegables por alumnos
**Arquitectura:** saga coreografiada, event-driven, database-per-service, AWS-first lab usado como escenario de incidente

---

# 1. Resumen ejecutivo

La clase deja de ser un recorrido top-down por servicios AWS y pasa a ser una experiencia de operación bajo presión.

Durante un evento tipo Black Friday, un marketplace ficticio llamado **MercadoFuego** lanza una nueva feature de checkout llamada **Promesa Express** y, al mismo tiempo, distintos equipos de infraestructura aplican cambios no coordinados. El sistema no está completamente caído: está peor. Algunas compras avanzan, otras se demoran, algunas quedan inconsistentes y el tracking visible para el comprador no siempre refleja la verdad interna.

La clase entra como **equipo SRE de guardia**. Su misión no es dejar una arquitectura perfecta, sino recuperar un flujo crítico defendible:

```text
pago aprobado
→ orden confirmada
→ fulfillment comprometido
→ shipment preparado
→ tracking visible para comprador
```

Durante la crisis, ese flujo se ve degradado:

```text
pago aprobado
→ orden confirmada tarde o duplicada
→ fulfillment se atrasa o falla
→ shipment queda bloqueado
→ tracking visible miente o queda viejo
```

La pregunta central ya no es:

```text
¿Podemos construir este flujo?
```

La pregunta pasa a ser:

```text
¿Qué sacrificamos, revertimos o degradamos para que el usuario todavía pueda comprar?
```

El sistema se divide en **4 microservicios máximo**, desplegados por voluntarios con Terraform. El resto de la clase actúa como war room: define SLOs de emergencia, prioriza síntomas, decide mitigaciones, evalúa trade-offs y exige evidencia.

La clase no busca memorizar servicios AWS. Busca practicar decisiones de arquitectura y operación:

```text
¿Qué flujo salva el negocio?
¿Qué métrica representa dolor del usuario?
¿Qué cambio revertimos primero?
¿Qué feature degradamos?
¿Cuándo escalar ayuda y cuándo amplifica el problema?
¿Qué evidencia necesitamos para confiar en el sistema?
¿Qué aprendimos para que el incidente no dependa de héroes?
```

Los microservicios se presentan como responsabilidades de negocio bajo presión, no como CRUDs:

| # | Microservicio          | Rol en el incidente                                                        |
| - | ---------------------- | -------------------------------------------------------------------------- |
| 1 | `order-management`     | Protege que un pago aprobado no cree caos comercial                        |
| 2 | `fulfillment-planning` | Decide si podemos cumplir lo vendido bajo presión                          |
| 3 | `shipment-preparation` | Convierte promesa en algo despachable; su falla bloquea sellers            |
| 4 | `buyer-order-tracking` | Representa la verdad percibida por el comprador; si miente, soporte arde   |

El sistema se coordina por eventos, sin un orquestador central. Este patrón calza con una **saga coreografiada**, donde cada servicio ejecuta una transacción local, publica eventos y los siguientes servicios reaccionan a esos eventos. AWS define la saga coreografiada como un patrón para preservar consistencia en transacciones distribuidas mediante suscripciones a eventos, y advierte que funciona mejor cuando hay pocos participantes, justamente lo que buscamos en una clase con máximo 4 servicios. ([AWS Documentation][1])

La frase operativa del PDR v2 es:

> No buscamos producción perfecta. Buscamos producción defendible.

---

# 2. Objetivo pedagógico

## Objetivo principal

Que los alumnos entiendan Cloud Computing recuperando confiabilidad bajo presión, no memorizando servicios aislados ni admirando una arquitectura ideal.

La arquitectura no es la solución en sí misma. Es el escenario donde se manifiestan malas decisiones, acoplamientos, deuda técnica, fallas parciales y trade-offs reales.

> Esta arquitectura no está para ser admirada. Está para ser interrogada bajo presión.

La clase debe responder preguntas como:

```text
¿Qué significa estar mal si el sistema todavía responde?
¿Qué flujo crítico salva el negocio?
¿Qué SLO representa dolor real del comprador?
¿Qué feature degradamos para proteger checkout?
¿Qué cambio de infraestructura revertimos primero?
¿Cuándo escalar workers arregla el problema y cuándo solo lo encarece?
¿Qué significa idempotencia?
¿Qué ve el comprador si internamente la saga avanzó pero el read model quedó viejo?
¿Qué evidencia necesitamos para confiar en una mitigación?
¿Cómo usamos Terraform para auditar, repetir, romper, revertir y limpiar?
```

---

