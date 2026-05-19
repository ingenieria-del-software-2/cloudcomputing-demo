# Consolidado V3 sobre V2 - 01-storytelling-flujo

> Estado: V3 aplicado como base actual. El detalle de V2 queda preservado debajo para evitar perdida de contenido durante la mezcla.

## Base V3 actual

## 7. Storytelling base

### 7.1 Apertura

Son las 00:03 del Black Friday de `CompraFiubi`.

La campaña arrancó hace minutos. Producto venía empujando una feature llamada **Promesa Express**, que intenta mostrar al comprador una promesa logística más agresiva:

```text
“Comprá ahora y llega mañana”
```

La feature se activó justo antes del pico.

Al mismo tiempo:

```text
Infra tocó configuración de workers y concurrencia.
Seguridad ajustó permisos de despacho.
Observabilidad subió el nivel de logs y métricas.
Producto activó una promo agresiva.
Soporte empezó a recibir reclamos.
```

Los dashboards iniciales no muestran una caída total. Algunas cosas están verdes. Algunas compras pasan. Algunas se atrasan. Algunas quedan en estados raros.

La pregunta del war room no es “¿qué servicio AWS usamos?”.

La pregunta es:

```text
¿Qué está sufriendo el usuario y qué podemos sacrificar para recuperar control?
```

### 7.2 Personajes opcionales para mensajes durante la clase

Estos personajes no requieren alumnos dedicados. El docente puede disparar mensajes cortos en cada etapa.

```text
Producto:
“La Promesa Express mejora conversión, no la apaguen si no están seguros.”

Soporte:
“Tenemos compradores que pagaron y no ven el estado actualizado.”

Infra:
“Los cambios eran chicos. Ninguno debería romper nada solo.”

Seguridad:
“Se ajustaron permisos para reducir superficie. No debería impactar negocio.”

SRE:
“Paren. Primero definamos qué significa estar mal.”
```

---

## 8. Flujo crítico

El flujo crítico se mantiene como Order-to-Ship:

```text
payment approved
→ order confirmed
→ fulfillment committed
→ shipment ready
→ buyer tracking updated
```

### 8.1 Interpretación de negocio

| Paso                     | Significado                                                          |
| ------------------------ | -------------------------------------------------------------------- |
| `payment approved`       | El comprador pagó; ahora el sistema le debe una respuesta confiable. |
| `order confirmed`        | Existe una orden comercial consistente.                              |
| `fulfillment committed`  | El sistema cree que puede cumplir lo vendido.                        |
| `shipment ready`         | Hay un despacho listo, o al menos un estado operativo honesto.       |
| `buyer tracking updated` | El comprador ve una verdad suficientemente fresca y no engañosa.     |

### 8.2 Qué significa salvar el negocio

Para esta clase, salvar el negocio no significa que todo el marketplace funcione. Significa:

```text
1. El comprador puede iniciar una compra.
2. El pago aprobado no genera caos comercial.
3. La orden no se duplica.
4. El sistema no promete stock o despacho de forma irresponsable.
5. El tracking visible no queda mintiendo durante demasiado tiempo.
```

### 8.3 Qué podemos sacrificar

Durante el incidente, se pueden sacrificar temporalmente:

```text
Promesa Express
precisión fina de la promesa logística
personalización
detalle de tracking no crítico
velocidad de features nuevas
nivel de logs demasiado verboso
procesamiento de eventos no críticos
```

No se debería sacrificar:

```text
idempotencia de pagos
consistencia mínima de stock/reserva
honestidad del estado visible
capacidad de reconstruir una orden
cleanup de recursos AWS
```

---


---

## Detalle V2 conservado

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

