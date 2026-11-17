# orders

Compras: crea la orden y coordina events → payments → tickets → notifications.

- **Puerto por defecto:** 3003
- **Datos que guarda:** Órdenes y su estado: pendiente, pagada, rechazada, cancelada (tabla `orders`).
- **Se comunica con:** events, payments, tickets y notifications (HTTP/JSON con tiempo máximo de espera).
- **Dependencias npm:** `express`, `pg`

## Requisitos

- Node.js 22.9 o superior
- PostgreSQL 15+ con la base `orders_db` y el usuario `orders_user` (script: `infra/scripts/init-db.sql`)

## Variables de entorno

Toda la configuración se lee de variables de entorno (nada está escrito en el código).

| Variable | Valor local | Descripción |
|---|---|---|
| `SERVICE_NAME` | `orders` | Nombre que aparece en los logs |
| `PORT` | `3003` | Puerto HTTP del servicio |
| `LOG_LEVEL` | `info` | debug, info, warn o error |
| `DB_HOST` | `localhost` | Servidor PostgreSQL |
| `DB_PORT` | `5432` | Puerto PostgreSQL |
| `DB_NAME` | `orders_db` | Base de datos PROPIA del servicio |
| `DB_USER` | `orders_user` | Usuario PROPIO del servicio |
| `DB_PASSWORD` | `orders_dev_pass` | Contraseña (en el servidor se genera una aleatoria) |
| `JWT_SECRET` | `dev-jwt-secret-cambiar` | Secreto compartido para firmar/validar JWT (igual en todos) |
| `INTERNAL_TOKEN` | `dev-internal-token-cambiar` | Token para llamadas entre servicios (igual en todos) |
| `HTTP_TIMEOUT_MS` | `5000` | Tiempo máximo de espera al llamar a otro servicio |
| `EVENTS_URL` | `http://localhost:3002` | URL de events |
| `PAYMENTS_URL` | `http://localhost:3004` | URL de payments |
| `TICKETS_URL` | `http://localhost:3005` | URL de tickets |
| `NOTIFICATIONS_URL` | `http://localhost:3006` | URL de notifications |
| `TICKETS_TIMEOUT_MS` | `15000` | Tiempo máximo para generar los PDF |
| `PUBLIC_URL` | `http://localhost:5173` | URL pública de la web (para el enlace del correo) |

## Cómo ejecutarlo

```bash
# 1. Desde la raíz del repositorio, instalar dependencias (una sola vez)
npm install

# 2. Crear el archivo de configuración
cd services/orders
cp .env.example .env        # en Windows CMD: copy .env.example .env

# 3. Arrancar (se reinicia solo al guardar cambios)
npm run dev

# 4. Comprobar
curl http://localhost:3003/health
```

La primera vez el servicio crea sus tablas automáticamente. Si la base de datos no responde,
el servicio sigue vivo, reintenta cada 5 segundos y `/health` responde **503**.

## Endpoints

A través de Nginx se accede como `/api/orders/...`.

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/` | cliente | Comprar `{event_id, sector_id, quantity (1-6), card_number}` |
| GET | `/mine` | token | Historial de compras |
| GET | `/:id` | token | Detalle de una orden propia |
| POST | `/:id/retry` | token | Reintenta emitir entradas/correo de una orden pagada |
| GET | `/health` | — | Chequeo de salud |

- **token**: cabecera `Authorization: Bearer <JWT>` emitido por auth.
- **interno**: cabecera `X-Internal-Token: <INTERNAL_TOKEN>`; solo otros servicios.

## En el servidor

Corre como `systemd` (`sudo systemctl status entradasya@orders`) con su configuración en
`/etc/entradasya/orders.env`. Logs: `journalctl -u entradasya@orders -f`.
