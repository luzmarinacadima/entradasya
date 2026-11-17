# notifications

Envía los correos del sistema a Mailpit (SMTP de pruebas). Servicio interno.

- **Puerto por defecto:** 3006
- **Datos que guarda:** Ninguno. Solo deja registro en sus logs.
- **Se comunica con:** Mailpit (SMTP).
- **Dependencias npm:** `express`, `nodemailer`

## Requisitos

- Node.js 22.9 o superior
- Mailpit escuchando en SMTP `localhost:1025` (web en http://localhost:8025)

## Variables de entorno

Toda la configuración se lee de variables de entorno (nada está escrito en el código).

| Variable | Valor local | Descripción |
|---|---|---|
| `SERVICE_NAME` | `notifications` | Nombre que aparece en los logs |
| `PORT` | `3006` | Puerto HTTP del servicio |
| `LOG_LEVEL` | `info` | debug, info, warn o error |
| `INTERNAL_TOKEN` | `dev-internal-token-cambiar` | Token para llamadas entre servicios (igual en todos) |
| `SMTP_HOST` | `localhost` | Servidor SMTP (Mailpit) |
| `SMTP_PORT` | `1025` | Puerto SMTP de Mailpit |
| `SMTP_SECURE` | `false` | SMTP con TLS |
| `SMTP_IGNORE_TLS` | `true` | Mailpit no usa TLS |
| `SMTP_TIMEOUT_MS` | `5000` | Tiempo máximo de conexión SMTP |
| `MAIL_FROM` | `EntradasYa <no-reply@entradasya.local>` | Remitente |
| `EVENT_TIMEZONE` | `America/La_Paz` | Zona horaria de las fechas |

## Cómo ejecutarlo

```bash
# 1. Desde la raíz del repositorio, instalar dependencias (una sola vez)
npm install

# 2. Crear el archivo de configuración
cd services/notifications
cp .env.example .env        # en Windows CMD: copy .env.example .env

# 3. Arrancar (se reinicia solo al guardar cambios)
npm run dev

# 4. Comprobar
curl http://localhost:3006/health
```

La primera vez el servicio crea sus tablas automáticamente. Si la base de datos no responde,
el servicio sigue vivo, reintenta cada 5 segundos y `/health` responde **503**.

## Endpoints

A través de Nginx se accede como `/api/notifications/...` (este servicio **no** se expone hacia afuera).

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/purchase` | interno | Correo de confirmación de compra |
| POST | `/welcome` | interno | Correo de bienvenida (opcional) |
| GET | `/health` | — | Chequeo de salud (conexión SMTP) |

- **token**: cabecera `Authorization: Bearer <JWT>` emitido por auth.
- **interno**: cabecera `X-Internal-Token: <INTERNAL_TOKEN>`; solo otros servicios.

## En el servidor

Corre como `systemd` (`sudo systemctl status entradasya@notifications`) con su configuración en
`/etc/entradasya/notifications.env`. Logs: `journalctl -u entradasya@notifications -f`.
