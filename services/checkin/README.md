# checkin

Control de ingreso: valida el código con tickets y registra el ingreso una sola vez.

- **Puerto por defecto:** 3007
- **Datos que guarda:** Ingresos registrados con fecha, hora y portero (tabla `checkins`, `ticket_code` único).
- **Se comunica con:** tickets.
- **Dependencias npm:** `express`, `pg`

## Requisitos

- Node.js 22.9 o superior
- PostgreSQL 15+ con la base `checkin_db` y el usuario `checkin_user` (script: `infra/scripts/init-db.sql`)

## Variables de entorno

Toda la configuración se lee de variables de entorno (nada está escrito en el código).

| Variable | Valor local | Descripción |
|---|---|---|
| `SERVICE_NAME` | `checkin` | Nombre que aparece en los logs |
| `PORT` | `3007` | Puerto HTTP del servicio |
| `LOG_LEVEL` | `info` | debug, info, warn o error |
| `DB_HOST` | `localhost` | Servidor PostgreSQL |
| `DB_PORT` | `5432` | Puerto PostgreSQL |
| `DB_NAME` | `checkin_db` | Base de datos PROPIA del servicio |
| `DB_USER` | `checkin_user` | Usuario PROPIO del servicio |
| `DB_PASSWORD` | `checkin_dev_pass` | Contraseña (en el servidor se genera una aleatoria) |
| `JWT_SECRET` | `dev-jwt-secret-cambiar` | Secreto compartido para firmar/validar JWT (igual en todos) |
| `INTERNAL_TOKEN` | `dev-internal-token-cambiar` | Token para llamadas entre servicios (igual en todos) |
| `HTTP_TIMEOUT_MS` | `5000` | Tiempo máximo de espera al llamar a otro servicio |
| `TICKETS_URL` | `http://localhost:3005` | URL de tickets |

## Cómo ejecutarlo

```bash
# 1. Desde la raíz del repositorio, instalar dependencias (una sola vez)
npm install

# 2. Crear el archivo de configuración
cd services/checkin
cp .env.example .env        # en Windows CMD: copy .env.example .env

# 3. Arrancar (se reinicia solo al guardar cambios)
npm run dev

# 4. Comprobar
curl http://localhost:3007/health
```

La primera vez el servicio crea sus tablas automáticamente. Si la base de datos no responde,
el servicio sigue vivo, reintenta cada 5 segundos y `/health` responde **503**.

## Endpoints

A través de Nginx se accede como `/api/checkin/...`.

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/` | portero | `{code, event_id}` → permitido, o rechazado con motivo |
| GET | `/stats` | portero/organizador | Personas que ingresaron por evento |
| GET | `/stats/:eventId` | portero/organizador | Total y últimos ingresos de un evento |
| GET | `/health` | — | Chequeo de salud |

- **token**: cabecera `Authorization: Bearer <JWT>` emitido por auth.
- **interno**: cabecera `X-Internal-Token: <INTERNAL_TOKEN>`; solo otros servicios.

## En el servidor

Corre como `systemd` (`sudo systemctl status entradasya@checkin`) con su configuración en
`/etc/entradasya/checkin.env`. Logs: `journalctl -u entradasya@checkin -f`.
