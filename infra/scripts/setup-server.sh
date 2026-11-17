#!/usr/bin/env bash
# =====================================================================
# EntradasYa v1 · Preparación del servidor Ubuntu (se ejecuta UNA vez)
#
#   scp -i entradasya.pem infra/scripts/setup-server.sh ubuntu@IP:~
#   ssh -i entradasya.pem ubuntu@IP
#   sudo bash setup-server.sh
#
# Instala TODO a mano, sin contenedores: Node.js 22, PostgreSQL, Nginx y Mailpit.
# Crea una base de datos y un usuario por servicio, los archivos de
# configuración /etc/entradasya/<servicio>.env y las carpetas necesarias.
# Se puede volver a ejecutar sin romper nada (es idempotente).
# Después, el pipeline (GitHub Actions) copia el código y ejecuta deploy.sh.
# =====================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Ejecuta con sudo: sudo bash $0"; exit 1; fi

APP_USER="${APP_USER:-${SUDO_USER:-ubuntu}}"
APP_DIR=/opt/entradasya
ENV_DIR=/etc/entradasya
TICKETS_DIR=/var/lib/entradasya/tickets
WEB_DIR=/var/www/entradasya
DB_SERVICES="auth events orders payments tickets checkin"

log() { echo -e "\n\033[1;31m==>\033[0m $(date '+%F %T') $*"; }

log "Usuario de la aplicación: $APP_USER"

# --- Memoria de intercambio (t3.micro tiene 1 GB de RAM) --------------
if ! swapon --show | grep -q '/swapfile'; then
  log "Creando 2 GB de swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- Paquetes base ----------------------------------------------------
log "Instalando paquetes base, PostgreSQL y Nginx"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg git rsync openssl nginx postgresql postgresql-contrib

# --- Node.js 22 -------------------------------------------------------
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  log "Instalando Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
log "Node $(node -v) · npm $(npm -v)"

# --- Mailpit (correo de prueba) ---------------------------------------
if ! command -v mailpit >/dev/null; then
  log "Instalando Mailpit"
  bash < <(curl -fsSL https://raw.githubusercontent.com/axllent/mailpit/develop/install.sh)
fi
cat > /etc/systemd/system/mailpit.service <<EOF
[Unit]
Description=Mailpit - servidor de correo de prueba
After=network.target

[Service]
User=$APP_USER
ExecStart=$(command -v mailpit) --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025 --webroot /mailpit/
Restart=always

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now mailpit

# --- Carpetas ---------------------------------------------------------
log "Creando carpetas"
mkdir -p "$APP_DIR" "$ENV_DIR" "$TICKETS_DIR" "$WEB_DIR"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR" "$TICKETS_DIR" "$WEB_DIR"

# --- Secretos (se generan una sola vez) -------------------------------
SECRETS="$ENV_DIR/.secrets"
if [[ ! -f "$SECRETS" ]]; then
  log "Generando secretos aleatorios en $SECRETS"
  {
    echo "JWT_SECRET=$(openssl rand -hex 32)"
    echo "INTERNAL_TOKEN=$(openssl rand -hex 32)"
    for s in $DB_SERVICES; do echo "${s^^}_DB_PASSWORD=$(openssl rand -hex 16)"; done
  } > "$SECRETS"
  chmod 600 "$SECRETS"
fi
# shellcheck disable=SC1090
source "$SECRETS"

PUBLIC_IP="$(curl -fsS --max-time 3 https://checkip.amazonaws.com 2>/dev/null || hostname -I | awk '{print $1}')"
PUBLIC_URL="${PUBLIC_URL:-http://$PUBLIC_IP}"

# --- PostgreSQL: una base y un usuario por servicio -------------------
log "Creando bases de datos (una por servicio)"
systemctl enable --now postgresql
psql_admin() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qAt "$@"; }
for s in $DB_SERVICES; do
  user="${s}_user"; db="${s}_db"; var="${s^^}_DB_PASSWORD"; pass="${!var}"
  if [[ -z "$(psql_admin -c "SELECT 1 FROM pg_roles WHERE rolname='$user'")" ]]; then
    psql_admin -c "CREATE ROLE $user LOGIN PASSWORD '$pass'"
  else
    psql_admin -c "ALTER ROLE $user WITH LOGIN PASSWORD '$pass'"
  fi
  if [[ -z "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname='$db'")" ]]; then
    psql_admin -c "CREATE DATABASE $db OWNER $user"
  fi
  psql_admin -c "REVOKE CONNECT ON DATABASE $db FROM PUBLIC"
  psql_admin -c "GRANT CONNECT ON DATABASE $db TO $user"
  echo "   ✓ $db  (usuario $user)"
done

# --- Archivos de configuración por servicio ---------------------------
log "Escribiendo /etc/entradasya/<servicio>.env"
common() {
  cat <<EOF
SERVICE_NAME=$1
PORT=$2
LOG_LEVEL=info
HTTP_TIMEOUT_MS=5000
JWT_SECRET=$JWT_SECRET
INTERNAL_TOKEN=$INTERNAL_TOKEN
EOF
}
db_env() {
  local var="${1^^}_DB_PASSWORD"
  cat <<EOF
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=${1}_db
DB_USER=${1}_user
DB_PASSWORD=${!var}
EOF
}
write_env() { # nombre, contenido
  printf '%s\n' "$2" > "$ENV_DIR/$1.env"
  chown root:"$APP_USER" "$ENV_DIR/$1.env"
  chmod 640 "$ENV_DIR/$1.env"
  echo "   ✓ $ENV_DIR/$1.env"
}

write_env auth "$(common auth 3001)
$(db_env auth)
JWT_EXPIRES_IN_S=28800
ALLOW_ROLE_SIGNUP=true"

write_env events "$(common events 3002)
$(db_env events)"

write_env orders "$(common orders 3003)
$(db_env orders)
EVENTS_URL=http://127.0.0.1:3002
PAYMENTS_URL=http://127.0.0.1:3004
TICKETS_URL=http://127.0.0.1:3005
NOTIFICATIONS_URL=http://127.0.0.1:3006
TICKETS_TIMEOUT_MS=15000
PUBLIC_URL=$PUBLIC_URL"

write_env payments "$(common payments 3004)
$(db_env payments)
REJECT_CARD_SUFFIX=0000"

write_env tickets "$(common tickets 3005)
$(db_env tickets)
TICKETS_DIR=$TICKETS_DIR
EVENT_TIMEZONE=America/La_Paz"

write_env notifications "$(common notifications 3006)
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_IGNORE_TLS=true
SMTP_TIMEOUT_MS=5000
MAIL_FROM=EntradasYa <no-reply@entradasya.local>
EVENT_TIMEZONE=America/La_Paz"

write_env checkin "$(common checkin 3007)
$(db_env checkin)
TICKETS_URL=http://127.0.0.1:3005"

# --- Permitir que el pipeline reinicie servicios sin contraseña -------
# (en EC2 el usuario ubuntu ya tiene sudo sin contraseña; esto es por si acaso)
echo "$APP_USER ALL=(root) NOPASSWD: /usr/bin/bash $APP_DIR/infra/scripts/deploy.sh" > /etc/sudoers.d/entradasya-deploy
chmod 440 /etc/sudoers.d/entradasya-deploy

# --- Nginx: quitar el sitio por defecto -------------------------------
rm -f /etc/nginx/sites-enabled/default
systemctl enable nginx

log "Servidor listo ✅"
cat <<EOF

  Siguiente paso: haz push a la rama main en GitHub.
  El pipeline copiará el código a $APP_DIR y ejecutará deploy.sh.

  (O despliega a mano:  sudo bash $APP_DIR/infra/scripts/deploy.sh  después de copiar el código)

  Web:      $PUBLIC_URL
  Mailpit:  $PUBLIC_URL/mailpit/
  Secretos: $SECRETS  (no los compartas)
EOF
