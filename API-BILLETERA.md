# API Billetera Bitso FluoGames

Solo lectura · v1.0 · CriptoBlue

---

## Conexión

```
GET https://criptoblue.vercel.app/api/v1/billetera?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
Authorization: Bearer <API_KEY>
```

| | |
|---|---|
| Formato | JSON |
| Métodos | solo `GET` · el resto devuelve `405` |
| `desde` / `hasta` | `YYYY-MM-DD`, obligatorios, ambos inclusive |
| Rate limit | 10 req/min por key · `429` + header `Retry-After` |
| Rango máximo | 180 días |
| Antigüedad máxima | 180 días hacia atrás |

La key es de esta billetera únicamente. En la base solo vive su hash SHA-256.

> **La key NO va en este archivo.** Este repositorio es público: cualquier key escrita
> acá queda expuesta y hay que revocarla. Se genera con
> `node scripts/generar-api-key.mjs --billetera "<nombre>"`, se muestra una sola vez y
> se entrega por un canal privado.

```bash
curl -H "Authorization: Bearer $KEY" \
  "https://criptoblue.vercel.app/api/v1/billetera?desde=2026-07-01&hasta=2026-07-31"
```

---

## Respuesta

```json
{
  "billetera": "Bitso FluoGames",
  "moneda_saldo": "ARS",
  "comision_pct": 0,
  "desde": "2026-07-30",
  "hasta": "2026-07-31",
  "dias": [
    {
      "fecha": "2026-07-31",
      "ingresos": {
        "ars": 81430,
        "cantidad": 4,
        "pagos": [
          {
            "hora": "2026-07-31T11:12:53-03:00",
            "titular": "BARREIROS OSVALDO MATIAS",
            "cuit": "20389132854",
            "ars": 17850,
            "comision_ars": 0,
            "estado": "pendiente",
            "tienda": null,
            "orden": null
          }
        ]
      },
      "comision": { "pct": 0, "ars": 0 },
      "retiros": [],
      "reembolsos": [],
      "ajustes": [],
      "saldo_neto_dia_ars": 81430
    }
  ]
}
```

### Esquema

| Campo | Tipo | Detalle |
|---|---|---|
| `comision_pct` | number | % vigente de la billetera |
| `dias[].fecha` | string | `YYYY-MM-DD`, día ART |
| `dias[].ingresos.ars` | number | total bruto del día |
| `dias[].ingresos.cantidad` | number | cantidad de pagos |
| `dias[].comision.ars` | number | comisión del día |
| `dias[].saldo_neto_dia_ars` | number | `ingresos − comisión − retiros − reembolsos + ajustes` |

**`ingresos.pagos[]`**

| Campo | Tipo | Detalle |
|---|---|---|
| `hora` | string | ISO con offset `-03:00` |
| `titular` | string \| null | pagador según la fuente |
| `cuit` | string \| null | CUIT/CUIL del pagador |
| `ars` | number | bruto, sin descontar comisión |
| `comision_ars` | number | `ars × comision_pct / 100` |
| `estado` | enum | `emparejado` \| `pendiente` \| `reembolsado` |
| `tienda` | string \| null | tienda de la orden |
| `orden` | string \| null | N° de orden |

**`retiros[]`**

| Campo | Tipo | Detalle |
|---|---|---|
| `hora` | string | ISO `-03:00` |
| `concepto` | string | motivo |
| `moneda` | string \| null | moneda original: `ARS` \| `USD` \| `USDT` |
| `monto` | number \| null | monto en esa moneda |
| `cotizacion` | number \| null | ARS por unidad · `null` si ya era ARS |
| `ars` | number | descontado del saldo |

**`reembolsos[]`** → `hora`, `concepto` (incluye N° de orden), `tienda`, `ars`

**`ajustes[]`** → `hora`, `concepto`, `ars`

---

## Particularidades

**La fecha es la de ingreso del dinero, no la del emparejamiento.** Un pago que entró
el 30 a las 23:59 y se emparejó el 31 pertenece al día **30**. No se puede reconciliar
contra el registro de una tienda por fecha: las tiendas se fechan por emparejamiento.

**Los días vacíos vienen igual, en cero.** El array `dias` siempre tiene un elemento
por cada fecha del rango. No hay que interpolar.

**`ars` es bruto.** La comisión no está descontada: viene aparte, por pago
(`comision_ars`) y por día (`comision.ars`). Sumar `ingresos.ars` da volumen bruto,
no saldo.

**`estado: "pendiente"` con `tienda: null` y `orden: null` es lo normal en esta
billetera.** Bitso FluoGames no cruza pagos con órdenes. No es un pago sin resolver ni
un error de datos: no existe orden que asociar. Tratar esos `null` como estado válido,
no como faltante.

**`estado: "reembolsado"` sigue sumando a `ingresos`.** Marca que la orden asociada
tuvo un reembolso; el egreso figura por separado en `reembolsos[]`. Restarlo de los
ingresos lo contaría dos veces.

**Los retiros pueden no ser en pesos.** `moneda` y `monto` son los originales; `ars` es
la conversión que impactó el saldo. Para totales en pesos usar siempre `ars`.

**`ajustes[]` aparece solo si la billetera tiene fecha de corte y cae en el rango.** Es
el saldo inicial desde el que se cuenta; suma.

**`cuit` puede venir `null`.** Depende de la fuente del pago. Bitso por API lo informa;
otras fuentes no. No asumir presencia.

**Los montos vienen redondeados a 2 decimales.** No volver a redondear.

**Las fechas del filtro son días argentinos** (UTC−3), de 00:00 a 23:59:59. El backend
convierte; no mandar UTC.

---

## Errores

Siempre `{ "error": "..." }`.

| Código | Causa | Reintentar |
|---|---|---|
| `400` | falta o mal formato de `desde`/`hasta`, o `desde` > `hasta` | no |
| `401` | falta la key o es inválida | no |
| `403` | key revocada, o no corresponde a este endpoint | no |
| `404` | la billetera ya no está disponible | no |
| `422` | rango > 180 días, o antigüedad > 180 días | no |
| `429` | rate limit | sí, según `Retry-After` |
| `500` | error interno | sí, con backoff |

Para históricos largos: partir en tramos de 180 días y espaciar las llamadas.

---

## Operación

Toda request queda auditada del lado del servidor: key, endpoint, rango, status, IP,
user-agent y duración. Para reportar un problema alcanza con la hora aproximada, el
rango pedido y el código de error.

La revocación es inmediata: la key deja de funcionar en la request siguiente.
