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

