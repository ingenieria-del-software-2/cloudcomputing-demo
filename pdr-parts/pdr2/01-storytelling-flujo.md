# 3. Problema que queremos modelar

Durante Black Friday, una orden aprobada no alcanza con “existir”. El negocio necesita que la orden avance rápido, de forma confiable y con un estado visible honesto para el comprador.

El problema no arranca con un sistema sano. Arranca con una producción heredada y degradada por cambios simultáneos:

```text
23:20 Infra ajusta workers, concurrencia y timeouts.
23:35 Seguridad cambia permisos IAM.
23:40 Observabilidad sube logging y métricas “para ver mejor”.
23:50 Producto activa Promesa Express.
00:00 Black Friday empieza.
00:03 Soporte reporta reclamos.
00:08 Fulfillment ve backlog.
00:12 Tracking visible queda atrasado.
```

La nueva feature **Promesa Express** intenta mostrar una promesa comercial más atractiva:

```text
Comprá ahora y llega mañana.
```

La feature es valiosa para conversión, pero mete presión sobre stock, fulfillment, generación de shipment y tracking visible.

## Journey crítico

```text
1. El comprador paga.
2. El pago es aprobado.
3. La orden se confirma comercialmente.
4. Se reserva/alloca stock.
5. Se compromete una promesa de fulfillment.
6. Se crea el shipment.
7. Se generan etiqueta e instrucciones.
8. El comprador ve el estado actualizado.
```

## Journey degradado durante Black Friday

```text
1. El comprador paga.
2. El pago es aprobado.
3. La orden se confirma tarde o se intenta duplicar.
4. Fulfillment se atrasa por backlog o Promesa Express.
5. Shipment queda bloqueado por permisos o documentos.
6. El tracking visible queda viejo o muestra un estado engañoso.
7. Soporte recibe reclamos aunque varios servicios sigan “up”.
```

## Dolor de negocio si falla

| Falla                                | Impacto                                      |
| ------------------------------------ | -------------------------------------------- |
| Pago aprobado sin orden visible      | Desconfianza, reclamos, doble compra         |
| Orden confirmada sin stock           | Cancelación, pérdida de reputación, reclamos |
| Promesa logística tardía o inestable | Incertidumbre, consultas a soporte           |
| Shipment sin etiqueta                | El vendedor no puede despachar               |
| Tracking desactualizado              | El comprador no entiende qué pasa            |
| Eventos duplicados mal manejados     | Órdenes duplicadas o estados corruptos       |
| Promesa Express degradando checkout  | Se protege una feature y se sacrifica compra |
| Backlog silencioso                   | El sistema está vivo pero incumple el SLO    |
| Cambio IAM mal coordinado            | Sellers no pueden despachar                  |

---

