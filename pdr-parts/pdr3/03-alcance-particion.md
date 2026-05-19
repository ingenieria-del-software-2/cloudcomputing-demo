## 10. Microservicios

V3 conserva 4 microservicios reales.

| # | Microservicio          | Responsabilidad narrativa                          | Dueño en clase |
| - | ---------------------- | -------------------------------------------------- | -------------- |
| 1 | `order-management`     | Evitar que un pago aprobado genere caos comercial. | Voluntario 1   |
| 2 | `fulfillment-planning` | Decidir si se puede cumplir lo vendido.            | Voluntario 2   |
| 3 | `shipment-preparation` | Convertir commitment en algo despachable.          | Voluntario 2   |
| 4 | `buyer-order-tracking` | Mostrar una verdad fresca y honesta al comprador.  | Voluntario 3   |

### 10.1 Por qué 4 servicios aunque hay 3 voluntarios

Se mantienen 4 servicios porque permiten mostrar más capacidades cloud sin volver la clase inmanejable:

```text
order-management       → RDS, idempotencia, entrada de pagos
fulfillment-planning   → RDS, backlog, Promesa Express, stock
shipment-preparation   → S3, IAM, documentos
buyer-order-tracking   → DynamoDB, read model, freshness, experiencia visible
```

El voluntario 2 opera dos servicios porque `fulfillment` y `shipment` están naturalmente conectados en la historia y pueden desplegarse juntos.

---

## 11. Roles de la clase

### 11.1 Docente

El docente actúa como:

```text
Incident Commander
SRE principal
facilitador de decisiones
narrador del incidente
controlador del tiempo
```

No delega la conducción del incidente porque la clase no tiene preparación previa y hay que evitar caos.

### 11.2 Voluntario 1 — Checkout / Order Team

Responsabilidad:

```text
Desplegar y operar order-management.
Simular pagos aprobados.
Verificar idempotencia.
Publicar eventos de orden confirmada.
Mostrar evidencia de orden creada.
```

Problemas que resuelve:

```text
payment_id duplicado
orden creada tarde
evento incompleto
falta de correlation_id
entrada de tráfico de prueba
```

### 11.3 Voluntario 2 — Fulfillment / Shipping Team

Responsabilidad:

```text
Desplegar y operar fulfillment-planning y shipment-preparation.
Reservar stock.
Activar/desactivar Promesa Express.
Generar shipment.
Guardar documento/etiqueta en S3.
Resolver fallo IAM de documentos.
```

Problemas que resuelve:

```text
latencia artificial por Promesa Express
backlog por worker/concurrency baja
stock insuficiente o reserva duplicada
s3:PutObject faltante
shipment bloqueado
```

### 11.4 Voluntario 3 — Buyer Experience / Tracking Team

Responsabilidad:

```text
Desplegar y operar buyer-order-tracking.
Exponer endpoint de tracking.
Mostrar freshness.
Ayudar a reconstruir timeline con correlation_id.
```

Problemas que resuelve:

```text
tracking stale
read model desactualizado
eventos fuera de orden
falta de evidencia visible para comprador
```

### 11.5 Resto de la clase

El resto de la clase actúa como war room ampliada:

```text
vota hipótesis
critica decisiones
propone mitigaciones
elige qué sacrificar
ayuda a construir timeline
identifica métricas útiles vs ruido
participa en nota de guardia
```

---

