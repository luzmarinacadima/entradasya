# Bitácora de problemas (instalación, versiones y despliegue)

> El PDF pide llevar esta bitácora durante el desarrollo y el despliegue.
> Cada problema anotado aquí es un "dolor" que en la siguiente etapa del módulo
> se resolverá con contenedores (Docker), así que vale la pena registrarlos bien.

**Formato:** fecha · dónde (PC / servidor / pipeline) · problema · causa · solución · ¿lo resolvería un contenedor?

---

### 2026-11-16 · PC (Windows) · `go` no se reconoce como comando
- **Causa:** Go no está instalado; el PDF sugiere Go para payments y checkin.
- **Solución:** como cada grupo elige el lenguaje, usamos Node.js 22, que ya estaba instalado.
- **¿Contenedor?** Sí: con Docker no hace falta instalar Go en la PC; la imagen `golang` lo trae.

### 2026-11-16 · PC (Windows) · `psql` no se reconoce como comando
- **Causa:** PostgreSQL está instalado pero su carpeta `bin` no está en el PATH.
- **Solución:** usar pgAdmin (Query Tool) para ejecutar `infra/scripts/init-db.sql`, o agregar `C:\Program Files\PostgreSQL\17\bin` al PATH.
- **¿Contenedor?** Sí: `docker run postgres` trae su propio `psql`.

### 2026-11-16 · PC (Windows) · `setx PATH` truncó el PATH a 1024 caracteres
- **Causa:** `setx` guarda como máximo 1024 caracteres y además mezcla el PATH del sistema con el del usuario.
- **Solución:** reconstruir el PATH de usuario con PowerShell (`[Environment]::SetEnvironmentVariable`), que no tiene ese límite. Nunca usar `setx PATH "%PATH%;..."`.
- **¿Contenedor?** Sí: cada imagen tiene su propio PATH y no se toca el de la PC.

### 2026-11-16 · PC (Windows) · Dos versiones de PostgreSQL (15 y 17) configuradas en el puerto 5432
- **Causa:** instalaciones antiguas; solo el servicio de la 17 está registrado y activo.
- **Solución:** usar PostgreSQL 17 en el puerto 5432.
- **¿Contenedor?** Sí: cada versión corre aislada y se elige el puerto al levantarla.

### 2026-11-16 · PC (Windows) · Poco espacio en disco (~10–17 GB libres)
- **Causa:** el disco se usa también para grabaciones.
- **Solución:** no instalar WSL/Docker Desktop todavía; programar en Windows y desplegar en una EC2 de AWS.
- **¿Contenedor?** En parte: las imágenes también ocupan espacio, pero se pueden borrar fácilmente (`docker system prune`).

### 2026-11-16 · PC (Windows) · `winget`, `code` y `aws` no se reconocían
- **Causa:** el `setx` anterior recortó el PATH de usuario y se perdieron `WindowsApps`, VS Code y npm; además, el instalador de la AWS CLI no agregó su carpeta al PATH de la terminal abierta.
- **Solución:** reconstruir el PATH con PowerShell y agregar `C:\Program Files\Amazon\AWSCLIV2`. Cerrar y abrir VS Code para que lo tome.
- **¿Contenedor?** Sí: la imagen `amazon/aws-cli` trae la CLI sin tocar el PATH.

### 2026-11-16 · AWS · `UnauthorizedOperation` al crear la EC2 en us-east-1
- **Causa:** la cuenta pertenece a una organización con una Service Control Policy que bloquea EC2 en casi todas las regiones (explicit deny).
- **Solución:** probar regiones con `aws ec2 describe-key-pairs --region <r>`; solo **us-east-2 (Ohio)** está permitida. El servidor se creó allí con `infra/scripts/create-ec2.ps1`.
- **¿Contenedor?** No: es una restricción de la cuenta de AWS, no del software.

### 2026-11-16 · Servidor · Instalación manual en la EC2
- **Detalle:** `setup-server.sh` instaló PostgreSQL 16 (no 17 como en la PC), Node 22.23, Nginx 1.24 y Mailpit 1.33; se agregó swap de 2 GB porque t3.micro solo tiene 1 GB de RAM.
- **Riesgo:** versiones distintas entre la PC (PostgreSQL 17) y el servidor (PostgreSQL 16).
- **¿Contenedor?** Sí: la misma imagen (`postgres:17`, `node:22`) correría igual en la PC y en el servidor.

---

<!-- Copia esta plantilla para cada problema nuevo:

### AAAA-MM-DD · PC / Servidor / Pipeline · Título corto
- **Causa:**
- **Solución:**
- **¿Contenedor?**
-->
