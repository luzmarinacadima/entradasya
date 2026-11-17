# tickets

Genera una entrada por asiento con código único, su PDF con QR, y valida códigos.

- **Puerto por defecto:** 3005
- **Datos que guarda:** Entradas emitidas (tabla `tickets`) y archivos PDF (en `TICKETS_DIR`).
- **Se comunica con:** Ningún servicio. Responde a orders y a checkin.
- **Dependencias npm:** `express`, `pdfkit`, `pg`, `qrcode`

## Requisitos

- Node.js 22.9 o superior
- PostgreSQL 15+ con la base `tickets_db` y el usuario `tickets_user` (script: `infra/scripts/init-db.sql`)
- Permiso de escritura en la carpeta `TICKETS_DIR`

## Variables de entorno

Toda la configuración se lee de variables de entorno (nada está escrito en el código).

| Variable | Valor local | Descripción |
|---|---|---|
| `SERVICE_NAME` | `tickets` | Nombre que aparece en los logs |
| `PORT` | `3005` | Puerto HTTP del servicio |
| `LOG_LEVEL` | `info` | debug, info, warn o error |
| `DB_HOST` | `localhost` | Servidor PostgreSQL |
| `DB_PORT` | `5432` | Puerto PostgreSQL |
| `DB_NAME` | `tickets_db` | Base de datos PROPIA del servicio |
| `DB_USER` | `tickets_user` | Usuario PROPIO del servicio |
| `DB_PASSWORD` | `tickets_dev_pass` | Contraseña (en el servidor se genera una aleatoria) |
| `JWT_SECRET` | `dev-jwt-secret-cambiar` | Secreto compartido para firmar/validar JWT (igual en todos) |
| `INTERNAL_TOKEN` | `dev-internal-token-cambiar` | Token para llamadas entre servicios (igual en todos) |
| `TICKETS_DIR` | `./data/tickets` | Carpeta local donde se guardan los PDF |
| `EVENT_TIMEZONE` | `America/La_Paz` | Zona horaria para imprimir la fecha |

## Cómo ejecutarlo

```bash
# 1. Desde la raíz del repositorio, instalar dependencias (una sola vez)
npm install

# 2. Crear el archivo de configuración
cd services/tickets
cp .env.example .env        # en Windows CMD: copy .env.example .env

# 3. Arrancar (se reinicia solo al guardar cambios)
npm run dev

# 4. Comprobar
curl http://localhost:3005/health
```

La primera vez el servicio crea sus tablas automáticamente. Si la base de datos no responde,
el servicio sigue vivo, reintenta cada 5 segundos y `/health` responde **503**.

## Endpoints

A través de Nginx se accede como `/api/tickets/...`.

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/internal/generate` | interno | Emite entradas + PDF de una orden (idempotente) |
| GET | `/internal/validate/:code` | interno | ¿Existe?, ¿de qué evento?, ¿es válida? |
| GET | `/mine` | token | Mis entradas |
| GET | `/order/:orderId` | token | Entradas de una orden propia |
| GET | `/:code/pdf` | token | Descargar el PDF (solo el dueño) |
| GET | `/health` | — | Chequeo de salud (base de datos + carpeta) |

- **token**: cabecera `Authorization: Bearer <JWT>` emitido por auth.
- **interno**: cabecera `X-Internal-Token: <INTERNAL_TOKEN>`; solo otros servicios.

## En el servidor

Corre como `systemd` (`sudo systemctl status entradasya@tickets`) con su configuración en
`/etc/entradasya/tickets.env`. Logs: `journalctl -u entradasya@tickets -f`.
