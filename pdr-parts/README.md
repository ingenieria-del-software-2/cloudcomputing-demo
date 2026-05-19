# PDR parts

Objetivo: trabajar `PDR.md` y `PDR3.md` por pares tematicos sin modificar los archivos originales.

Los archivos dentro de `pdr2/` y `pdr3/` usan los mismos nombres para facilitar comparacion y mezcla por bloque.

## Pares tematicos

| Archivo | `PDR.md` | `PDR3.md` | Tema |
| --- | ---: | ---: | --- |
| `00-contexto-resumen.md` | 1-108 | 1-185 | Contexto, resumen, objetivo, marco inicial |
| `01-storytelling-flujo.md` | 109-174 | 186-302 | Storytelling, Black Friday, flujo critico |
| `02-principios-slo.md` | 175-386 | 303-360 | Principios SRE, SLO, metricas de usuario |
| `03-alcance-particion.md` | 387-476 | 361-483 | Alcance, particion, microservicios, roles |
| `04-arquitectura-aws-deploy.md` | 477-567 | 484-725 | Arquitectura logica, AWS, despliegue, packaging |
| `05-ms-order.md` | 568-763 | 777-840 | Microservicio `order-management` |
| `06-ms-fulfillment.md` | 764-983 | 841-906 | Microservicio `fulfillment-planning` |
| `07-ms-shipment.md` | 984-1144 | 907-967 | Microservicio `shipment-preparation` |
| `08-ms-tracking.md` | 1145-1306 | 968-1032 | Microservicio `buyer-order-tracking` |
| `09-eventos-sqs-saga.md` | 1307-1623 | 726-776 | Contrato de eventos, eventos principales, SQS/saga |
| `10-observabilidad-seguridad-red.md` | 1624-1899 | 1510-1654 | SLOs/SLIs, observabilidad, IAM, red |
| `11-clase-stages-deploy.md` | 1900-2289 | 1267-1509 | Plan/stages de clase y despliegue operativo |
| `12-demo-datos-comandos.md` | 2290-2351 | 1655-1718 | Comandos, payloads, datos de prueba |
| `13-incidentes-fallas.md` | 2352-2587 | 1033-1266 | Incidentes narrativos, fallas controladas, mocks |
| `14-cierre-riesgos-adrs-cleanup.md` | 2588-3080 | 1719-2683 | Cierre, nota de guardia, cleanup, riesgos, ADRs, decisiones |

## Orden de reconstruccion

`PDR.md` se reconstruye concatenando `pdr2/*.md` en orden alfabetico.

`PDR3.md` cambio el orden interno de algunos temas. Para reconstruirlo exactamente, usar este orden:

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

## Verificacion

Se verifico que la concatenacion de las partes reconstruye exactamente cada original:

```text
PDR.md:  3080 lineas
PDR3.md: 2683 lineas
```
