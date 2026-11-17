# events

Catálogo de eventos, sectores (precio y cupo) y reserva/liberación de cupos.

- **Puerto por defecto:** 3002
- **Datos que guarda:** Eventos, sectores y cupos disponibles (tablas `events`, `sectors`).
- **Se comunica con:** Ningún servicio. Solo responde; `orders` le pide reservar y liberar cupos.
- **Dependencias npm:** `express`, `pg`

## Requisitos

- Node.js 22.9 o superior
- PostgreSQL 15+ con la base `events_db` y el usuario `events_user` (script: `infra/scripts/init-db.sql`)

## Variables de entorno

Toda la configuración se lee de variables de entorno (nada está escrito en el código).

| Variable | Valor local | Descripción |
|---|---|---|
| `SERVICE_NAME` | `events` | Nombre que aparece en los logs |
| `PORT` | `3002` | Puerto HTTP del servicio |
| `LOG_LEVEL` | `info` | debug, info, warn o error |
| `DB_HOST` | `localhost` | Servidor PostgreSQL |
| `DB_PORT` | `5432` | Puerto PostgreSQL |
| `DB_NAME` | `events_db` | Base de datos PROPIA del servicio |
| `DB_USER` | `events_user` | Usuario PROPIO del servicio |
| `DB_PASSWORD` | `events_dev_pass` | Contraseña (en el servidor se genera una aleatoria) |
| `JWT_SECRET` | `dev-jwt-secret-cambiar` | Secreto compartido para firmar/validar JWT (igual en todos) |
| `INTERNAL_TOKEN` | `dev-internal-token-cambiar` | Token para llamadas entre servicios (igual en todos) |

## Cómo ejecutarlo

```bash
# 1. Desde la raíz del repositorio, instalar dependencias (una sola vez)
npm install

# 2. Crear el archivo de configuración
cd services/events
cp .env.example .env        # en Windows CMD: copy .env.example .env

# 3. Arrancar (se reinicia solo al guardar cambios)
npm run dev

# 4. Comprobar
curl http://localhost:3002/health
```

La primera vez el servicio crea sus tablas automáticamente. Si la base de datos no responde,
el servicio sigue vivo, reintenta cada 5 segundos y `/health` responde **503**.

## Endpoints

A través de Nginx se accede como `/api/events/...`.

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/` | — | Cartelera: eventos publicados |
| GET | `/mine` | organizador | Mis eventos (todos los estados) |
| GET | `/:id` | — | Detalle (borradores solo para su organizador) |
| POST | `/` | organizador | Crear evento con `sectors: [{name, price, capacity}]` |
| PUT | `/:id` | organizador | Editar (sectores solo en borrador) |
| PATCH | `/:id/status` | organizador | `{status: 'publicado' | 'cancelado'}` |
| GET | `/:id/sales` | organizador | Ventas e ingresos por sector |
| POST | `/internal/reserve` | interno | Reserva atómica `{sector_id, quantity}` → 409 `Agotado` |
| POST | `/internal/release` | interno | Libera cupos `{sector_id, quantity}` |
| GET | `/health` | — | Chequeo de salud |

- **token**: cabecera `Authorization: Bearer <JWT>` emitido por auth.
- **interno**: cabecera `X-Internal-Token: <INTERNAL_TOKEN>`; solo otros servicios.

## En el servidor

Corre como `systemd` (`sudo systemctl status entradasya@events`) con su configuración en
`/etc/entradasya/events.env`. Logs: `journalctl -u entradasya@events -f`.
