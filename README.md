# EntradasYa v1

Plataforma de venta de entradas para eventos: **8 servicios independientes** que se comunican solo por **HTTP/JSON**,
cada uno con **su propia base de datos**, instalados **a mano en un servidor Ubuntu, sin contenedores**.
Proyecto del módulo *Contenedores y Orquestación* (Diplomado DevSecOps Essentials).

```
                         Servidor Ubuntu (EC2)
 Cliente      ┌──────────────────────────────────────────────────────────────┐
 Organizador ─┤ Nginx :80 ─┬─ web (React, archivos estáticos)                │
 Portero      │            ├─ /api/auth     → auth          :3001 ─┐         │
              │            ├─ /api/events   → events        :3002  │         │
              │            ├─ /api/orders   → orders        :3003  ├─ PostgreSQL (una BD por servicio)
              │            ├─ /api/tickets  → tickets       :3005  │         │
              │            └─ /api/checkin  → checkin       :3007 ─┘         │
              │   internos (no expuestos):  payments :3004 · notifications :3006 → Mailpit
              │   tickets guarda los PDF en /var/lib/entradasya/tickets       │
              └──────────────────────────────────────────────────────────────┘
```

| Servicio | Tecnología | Puerto | Base de datos | Llama a |
|---|---|---|---|---|
| [web](web/README.md) | React + Vite | 5173 (dev) / Nginx | — | todos, vía `/api` |
| [auth](services/auth/README.md) | Node.js + Express | 3001 | `auth_db` | — |
| [events](services/events/README.md) | Node.js + Express | 3002 | `events_db` | — |
| [orders](services/orders/README.md) | Node.js + Express | 3003 | `orders_db` | events, payments, tickets, notifications |
| [payments](services/payments/README.md) | Node.js + Express | 3004 | `payments_db` | — |
| [tickets](services/tickets/README.md) | Node.js + Express + PDFKit + QR | 3005 | `tickets_db` + carpeta | — |
| [notifications](services/notifications/README.md) | Node.js + Express + Nodemailer | 3006 | — | Mailpit (SMTP) |
| [checkin](services/checkin/README.md) | Node.js + Express | 3007 | `checkin_db` | tickets |

> El PDF dice que la tecnología de cada servicio es una **sugerencia**. Usamos Node.js en todos los servicios
> para tener un solo entorno que instalar y mantener; las etapas de Docker y Kubernetes funcionan igual.

## Requisitos técnicos (sección 8 del PDF) — dónde se cumplen

| # | Requisito | Implementación |
|---|---|---|
| 1 | Configuración por variables de entorno | `src/lib/config.js`; cada servicio tiene `.env.example`. En el servidor: `/etc/entradasya/<servicio>.env` |
| 2 | Base de datos propia, nunca la de otro | Un usuario y una base por servicio (`init-db.sql`, `setup-server.sh`) con `REVOKE CONNECT ... FROM PUBLIC` |
| 3 | Solo HTTP con JSON | `src/lib/http.js` (`fetch`) |
| 4 | Tiempo máximo de espera | `AbortSignal.timeout(HTTP_TIMEOUT_MS)` en toda llamada; SMTP con timeouts |
| 5 | Chequeo de salud | `GET /health` → 200 si funciona y tiene su BD/SMTP/carpeta; 503 si no |
| 6 | Logs con fecha, nivel y mensaje | `src/lib/logger.js` → `2026-11-16T21:00:00Z INFO  [orders] Orden pagada {...}` |
| 7 | README por servicio | `services/*/README.md` y `web/README.md` |
| — | Bitácora | [BITACORA.md](BITACORA.md) |

---

## 1. Ejecutar en tu PC (Windows)

**Necesitas:** Node.js 22.9+, PostgreSQL (con pgAdmin) y Git. Mailpit es opcional (sin él, las compras funcionan igual, solo no llega el correo).

```cmd
:: 1. Instalar dependencias de todos los servicios y la web (una vez)
npm install
```

**2. Crear las bases de datos:** abre pgAdmin → servidor PostgreSQL 17 → base `postgres` → *Query Tool* →
pega el contenido de [`infra/scripts/init-db.sql`](infra/scripts/init-db.sql) → Ejecutar (F5).

**3. (Opcional) Mailpit:** descarga `mailpit-windows-amd64.zip` de <https://github.com/axllent/mailpit/releases>,
descomprímelo y ejecuta `mailpit.exe`. Los correos se ven en <http://localhost:8025>.

```cmd
:: 4. Levantar los 7 servicios + la web en una sola terminal
npm run dev
```

Abre <http://localhost:5173>. La primera vez se crean solos los archivos `.env` (copiados de `.env.example`)
y las tablas de cada base de datos.

```cmd
:: 5. En otra terminal: prueba automática de todo el flujo y de los casos de error
npm run smoke
```

## 2. Desplegar en AWS (EC2 Ubuntu)

1. **Crear la instancia:** Ubuntu Server 24.04 LTS, `t3.micro`, 20 GB, key pair `entradasya.pem`.
   Security Group: puertos **22** (SSH) y **80** (HTTP). Asociar una **Elastic IP**.
2. **Preparar el servidor (una vez):**
   ```bash
   scp -i entradasya.pem infra/scripts/setup-server.sh ubuntu@IP:~
   ssh -i entradasya.pem ubuntu@IP
   sudo bash setup-server.sh
   ```
   Instala Node.js 22, PostgreSQL, Nginx y Mailpit; crea las 6 bases con contraseñas aleatorias y los `.env` de cada servicio.
3. **Configurar el pipeline:** en GitHub → *Settings → Secrets and variables → Actions* crea
   `EC2_HOST` (la Elastic IP), `EC2_USER` (`ubuntu`) y `EC2_SSH_KEY` (contenido completo del `.pem`).
4. **Push a `main`.** El pipeline ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) revisa el código,
   compila la web, copia todo al servidor y ejecuta [`deploy.sh`](infra/scripts/deploy.sh), que reinicia los servicios
   y verifica el `/health` de cada uno.
5. **Probar:** web en `http://IP`, correos en `http://IP/mailpit/`, y desde tu PC:
   `set GATEWAY=http://IP && npm run smoke`.

**Para no gastar:** detén la instancia (*Stop*) cuando no la uses. La Elastic IP solo cobra si la instancia está detenida
mucho tiempo; si no la necesitas, libérala.

### Comandos útiles en el servidor

```bash
sudo systemctl status entradasya@orders        # estado de un servicio
journalctl -u entradasya@orders -f             # logs en vivo
sudo systemctl restart entradasya@tickets      # reiniciar uno
curl localhost:3003/health                     # chequeo de salud
sudo systemctl stop entradasya@notifications   # probar: la compra sigue funcionando
```

## 3. Criterios de aceptación (sección 11 del PDF)

| Criterio | Cómo se comprueba |
|---|---|
| Cada servicio corre siguiendo su README y su `/health` responde | `npm run smoke` (paso 1) |
| Flujo completo: registro → compra → pago → PDF con QR → correo → ingreso; el 2.º escaneo se rechaza | `npm run smoke` (pasos 2–7) + Mailpit |
| Evento agotado no permite comprar; pago rechazado libera cupos; compra completa con notifications apagado | `npm run smoke` (paso 5) + detener notifications y repetir |
| Despliegue por pipeline en cada cambio a `main` | GitHub → Actions |

## Datos de prueba

- **Pago rechazado:** tarjeta que termina en `0000` (ej. `4111 1111 1111 0000`). Cualquier otra se aprueba.
- **Roles:** al registrarte eliges cliente, organizador o portero (`ALLOW_ROLE_SIGNUP=true`).

## Estructura

```
entradasya/
├── services/<servicio>/     src/index.js · src/lib/ · .env.example · README.md · package.json
├── web/                     React + Vite
├── infra/
│   ├── nginx/entradasya.conf
│   ├── systemd/entradasya@.service
│   └── scripts/  setup-server.sh · deploy.sh · init-db.sql
├── scripts/      dev.js · smoke-test.js · check.js
├── .github/workflows/deploy.yml
└── BITACORA.md
```
