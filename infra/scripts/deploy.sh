#!/usr/bin/env bash
# =====================================================================
# EntradasYa v1 · Despliegue (lo ejecuta el pipeline en cada push a main)
#   sudo bash /opt/entradasya/infra/scripts/deploy.sh
#
# 1. Instala dependencias  2. Compila la web  3. Actualiza Nginx y systemd
# 4. Reinicia los servicios  5. Verifica /health de cada uno
# =====================================================================
set -euo pipefail

APP_DIR=/opt/entradasya
WEB_DIR=/var/www/entradasya
APP_USER="${APP_USER:-$(stat -c '%U' "$APP_DIR")}"
declare -A PORTS=([auth]=3001 [events]=3002 [orders]=3003 [payments]=3004 [tickets]=3005 [notifications]=3006 [checkin]=3007)

log() { echo "$(date '+%F %T') [deploy] $*"; }
as_app() { sudo -u "$APP_USER" -H bash -c "cd $APP_DIR && $*"; }

[[ $EUID -eq 0 ]] || { echo "Ejecuta con sudo"; exit 1; }
[[ -f /etc/entradasya/.secrets ]] || { echo "Primero ejecuta setup-server.sh"; exit 1; }

chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

log "Instalando dependencias (npm)"
if [[ -f "$APP_DIR/package-lock.json" ]]; then
  as_app "npm ci --no-audit --no-fund"
else
  as_app "npm install --no-audit --no-fund"
fi

log "Compilando la web"
as_app "npm run build -w web"
rsync -a --delete "$APP_DIR/web/dist/" "$WEB_DIR/"

log "Actualizando systemd y Nginx"
sed "s/^User=.*/User=$APP_USER/" "$APP_DIR/infra/systemd/entradasya@.service" > /etc/systemd/system/entradasya@.service
systemctl daemon-reload
cp "$APP_DIR/infra/nginx/entradasya.conf" /etc/nginx/sites-available/entradasya
ln -sf /etc/nginx/sites-available/entradasya /etc/nginx/sites-enabled/entradasya
nginx -t
systemctl reload nginx || systemctl restart nginx

log "Reiniciando servicios"
for s in "${!PORTS[@]}"; do
  systemctl enable "entradasya@$s" >/dev/null 2>&1
  systemctl restart "entradasya@$s"
done

log "Verificando /health"
failed=0
for s in auth events orders payments tickets notifications checkin; do
  ok=0
  for _ in $(seq 1 20); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${PORTS[$s]}/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  if [[ $ok -eq 1 ]]; then
    log "  ✓ $s"
  else
    log "  ✗ $s no responde /health. Revisa: journalctl -u entradasya@$s -n 50"
    failed=1
  fi
done

[[ $failed -eq 0 ]] && log "Despliegue completo ✅" || { log "Despliegue con errores ❌"; exit 1; }
