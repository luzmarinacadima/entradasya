# payments

Pasarela de pago simulada (sin dinero real). Servicio interno: solo orders lo llama.

- **Puerto por defecto:** 3004
- **Datos que guarda:** Transacciones con monto, fecha y resultado (tabla `transactions`, `order_id` único = no cobra dos veces).
- **Se comunica con:** Ningún servicio. Solo responde a orders.
- **Dependencias npm:** `express`, `pg`

## Requisitos

- Node.js 22.9 o superior
- PostgreSQL 15+ con la base `payments_db` y el usuario `payments_user` (script: `infra/scripts/init-db.sql`)

## Variables de entorno

Toda la configuración se lee de variables de entorno (nada está escrito en el código).

| Variable | Valor local | Descripción |
|---|---|---|
| `SERVICE_NAME` | `payments` | Nombre que aparece en los logs |
| `PORT` | `3004` | Puerto HTTP del servicio |
| `LOG_LEVEL` | `info` | debug, info, warn o error |
| `DB_HOST` | `localhost` | Servidor PostgreSQL |
| `DB_PORT` | `5432` | Puerto PostgreSQL |
| `DB_NAME` | `payments_db` | Base de datos PROPIA del servicio |
| `DB_USER` | `payments_user` | Usuario PROPIO del servicio |
| `DB_PASSWORD` | `payments_dev_pass` | Contraseña (en el servidor se genera una aleatoria) |
| `INTERNAL_TOKEN` | `dev-internal-token-cambiar` | Token para llamadas entre servicios (igual en todos) |
| `REJECT_CARD_SUFFIX` | `0000` | Tarjetas que terminan así se rechazan |

## Cómo ejecutarlo

```bash
# 1. Desde la raíz del repositorio, instalar dependencias (una sola vez)
npm install

# 2. Crear el archivo de configuración
cd services/payments
cp .env.example .env        # en Windows CMD: copy .env.example .env

# 3. Arrancar (se reinicia solo al guardar cambios)
npm run dev

# 4. Comprobar
curl http://localhost:3004/health
```

La primera vez el servicio crea sus tablas automáticamente. Si la base de datos no responde,
el servicio sigue vivo, reintenta cada 5 segundos y `/health` responde **503**.

## Endpoints

A través de Nginx se accede como `/api/payments/...` (este servicio **no** se expone hacia afuera).

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/` | interno | Cobrar `{order_id, amount, card_number}` (idempotente) |
| GET | `/order/:orderId` | interno | Transacción de una orden |
| GET | `/health` | — | Chequeo de salud |

- **token**: cabecera `Authorization: Bearer <JWT>` emitido por auth.
- **interno**: cabecera `X-Internal-Token: <INTERNAL_TOKEN>`; solo otros servicios.

## En el servidor

Corre como `systemd` (`sudo systemctl status entradasya@payments`) con su configuración en
`/etc/entradasya/payments.env`. Logs: `journalctl -u entradasya@payments -f`.
