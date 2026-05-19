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

