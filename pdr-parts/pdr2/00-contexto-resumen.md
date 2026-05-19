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

