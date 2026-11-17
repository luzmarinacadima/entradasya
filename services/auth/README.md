# auth

Usuarios, roles (cliente, organizador, portero) e inicio de sesión con JWT.

- **Puerto por defecto:** 3001
- **Datos que guarda:** Usuarios y roles (tabla `users`). Contraseñas cifradas con scrypt.
- **Se comunica con:** Ningún servicio. Los demás validan el token por su cuenta con `JWT_SECRET`.
- **Dependencias npm:** `express`, `pg`

## Requisitos

- Node.js 22.9 o superior
- PostgreSQL 15+ con la base `auth_db` y el usuario `auth_user` (script: `infra/scripts/init-db.sql`)

## Variables de entorno

Toda la configuración se lee de variables de entorno (nada está escrito en el código).

| Variable | Valor local | Descripción |
|---|---|---|
| `SERVICE_NAME` | `auth` | Nombre que aparece en los logs |
| `PORT` | `3001` | Puerto HTTP del servicio |
| `LOG_LEVEL` | `info` | debug, info, warn o error |
| `DB_HOST` | `localhost` | Servidor PostgreSQL |
| `DB_PORT` | `5432` | Puerto PostgreSQL |
| `DB_NAME` | `auth_db` | Base de datos PROPIA del servicio |
| `DB_USER` | `auth_user` | Usuario PROPIO del servicio |
| `DB_PASSWORD` | `auth_dev_pass` | Contraseña (en el servidor se genera una aleatoria) |
| `JWT_SECRET` | `dev-jwt-secret-cambiar` | Secreto compartido para firmar/validar JWT (igual en todos) |
| `JWT_EXPIRES_IN_S` | `28800` | Duración del token en segundos (8 h) |
| `ALLOW_ROLE_SIGNUP` | `true` | Permite registrarse como organizador/portero (útil en clase) |

## Cómo ejecutarlo

```bash
# 1. Desde la raíz del repositorio, instalar dependencias (una sola vez)
npm install

# 2. Crear el archivo de configuración
cd services/auth
cp .env.example .env        # en Windows CMD: copy .env.example .env

# 3. Arrancar (se reinicia solo al guardar cambios)
npm run dev

# 4. Comprobar
curl http://localhost:3001/health
```

La primera vez el servicio crea sus tablas automáticamente. Si la base de datos no responde,
el servicio sigue vivo, reintenta cada 5 segundos y `/health` responde **503**.

## Endpoints

A través de Nginx se accede como `/api/auth/...`.

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/register` | — | Registro `{name,email,password,role?}` → `{user, token}` |
| POST | `/login` | — | Inicio de sesión `{email,password}` → `{user, token}` |
| GET | `/me` | token | Datos del usuario del token |
| GET | `/health` | — | Chequeo de salud (incluye la base de datos) |

- **token**: cabecera `Authorization: Bearer <JWT>` emitido por auth.
- **interno**: cabecera `X-Internal-Token: <INTERNAL_TOKEN>`; solo otros servicios.

## En el servidor

Corre como `systemd` (`sudo systemctl status entradasya@auth`) con su configuración en
`/etc/entradasya/auth.env`. Logs: `journalctl -u entradasya@auth -f`.
