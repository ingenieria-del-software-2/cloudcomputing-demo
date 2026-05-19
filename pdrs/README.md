# PDR parts

Objetivo: trabajar el PDR consolidado por partes pequenas para que los LLMs no pierdan contenido.

Estado actual:

```text
pdr-parts/*.md = fuente consolidada por partes
PDR3 fue aplicado sobre PDR2
el contenido V3 quedo copiado dentro de cada parte como "Base V3 actual"
el contenido V2 quedo preservado debajo como "Detalle V2 conservado"
```

Las carpetas intermedias `pdr-parts/pdr2/` y `pdr-parts/pdr3/` ya no se usan. El contenido consolidado vive directamente en `pdr-parts/`.

## Partes consolidadas

| Archivo | Tema |
| --- | --- |
| `00-contexto-resumen.md` | Contexto, resumen, objetivo, marco inicial |
| `01-storytelling-flujo.md` | Storytelling, Black Friday, flujo critico |
| `02-principios-slo.md` | Principios SRE, SLO, metricas de usuario |
| `03-alcance-particion.md` | Alcance, particion, microservicios, roles |
| `04-arquitectura-aws-deploy.md` | Arquitectura logica, AWS, despliegue, packaging |
| `05-ms-order.md` | Microservicio `order-management` |
| `06-ms-fulfillment.md` | Microservicio `fulfillment-planning` |
| `07-ms-shipment.md` | Microservicio `shipment-preparation` |
| `08-ms-tracking.md` | Microservicio `buyer-order-tracking` |
| `09-eventos-sqs-saga.md` | Contrato de eventos, eventos principales, SQS/saga |
| `10-observabilidad-seguridad-red.md` | SLOs/SLIs, observabilidad, IAM, red |
| `11-clase-stages-deploy.md` | Plan/stages de clase y despliegue operativo |
| `12-demo-datos-comandos.md` | Comandos, payloads, datos de prueba |
| `13-incidentes-fallas.md` | Incidentes narrativos, fallas controladas, mocks |
| `14-cierre-riesgos-adrs-cleanup.md` | Cierre, nota de guardia, cleanup, riesgos, ADRs, decisiones |

## Como usar cada parte

Cada archivo sigue esta estructura:

```text
# Consolidado V3 sobre V2 - <parte>

## Base V3 actual
...

---

## Detalle V2 conservado
...
```

Regla de mezcla recomendada:

```text
V3 manda en decisiones actuales.
V2 se usa para rescatar detalle tecnico, schemas, payloads, justificaciones y referencias.
```

## Reconstruccion

Para trabajar por tema, usar los archivos en orden alfabetico.

Para reconstruir la base V3 en el mismo orden de `PDR3.md`, usar este orden de partes:

```text
00-contexto-resumen.md
01-storytelling-flujo.md
02-principios-slo.md
03-alcance-particion.md
04-arquitectura-aws-deploy.md
09-eventos-sqs-saga.md
05-ms-order.md
06-ms-fulfillment.md
07-ms-shipment.md
08-ms-tracking.md
13-incidentes-fallas.md
11-clase-stages-deploy.md
10-observabilidad-seguridad-red.md
12-demo-datos-comandos.md
14-cierre-riesgos-adrs-cleanup.md
```

Ese orden no es alfabetico porque `PDR3.md` reorganiza eventos, microservicios, fallas, stages y observabilidad de forma distinta al orden tematico de trabajo.

## Verificacion previa

Antes de consolidar:

```text
PDR.md:  3080 lineas
PDR3.md: 2683 lineas
```

Despues de consolidar, se verifico que:

```text
la Base V3 actual extraida desde pdr-parts/*.md reconstruye PDR3.md exacto
el Detalle V2 conservado extraido desde pdr-parts/*.md reconstruye PDR.md exacto
```
