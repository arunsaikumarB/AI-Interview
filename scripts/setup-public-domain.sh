#!/usr/bin/env bash
# Serve HireOS at https://<hostname> with a free Let's Encrypt certificate (no VPN needed).
# Prerequisite (IT): public DNS <hostname> → office public IP, and ports 80 + 443 forwarded to this server.
#
#   sudo bash scripts/setup-public-domain.sh hireos.example.com [email-for-expiry-notices]
#
# Order: checks → certbot → ACME path on port 80 → certificate → nginx uses it → HTTPS check →
# NEXT_PUBLIC_APP_URL in .env. Any nginx change that fails `nginx -t` is rolled back.
# See docs/DEPLOYMENT-CENTOS9.md section 14. Safe to run again (renewal is automatic).
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="$APP_DIR/.env"
APP_PORT="${APP_PORT:-5000}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/conf.d/hireos.conf}"
WEBROOT="/var/www/letsencrypt"

log() { printf '[domain %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { log "FAILED: $*"; exit 1; }

host="${1:-}"
email="${2:-}"
[[ "$host" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]] \
  || die "usage: sudo bash scripts/setup-public-domain.sh <hostname> [email]"
[[ $EUID -eq 0 ]] || die "run with sudo"

healthy_body() { [[ "$1" == *'"database":{"ok":true}'* ]]; }

apply_nginx() {
  # $1 = new content file. Installs it, rolls back if nginx rejects it.
  local backup="$NGINX_SITE.bak-$(date +%Y%m%d%H%M%S)"
  cp -p "$NGINX_SITE" "$backup"
  cat "$1" >"$NGINX_SITE"
  if ! nginx -t >/dev/null 2>&1; then
    nginx -t || true
    cat "$backup" >"$NGINX_SITE"
    die "nginx rejected the change; $NGINX_SITE restored"
  fi
  systemctl reload nginx
  sleep 3   # reload returns before nginx workers switch to the new config
}

# 1. Checks -------------------------------------------------------------------------------
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found (set APP_DIR=/path/to/app)"
[[ -f "$NGINX_SITE" ]] || die "$NGINX_SITE not found (section 5.2)"
grep -q 'return 301 https://\$host\$request_uri;' "$NGINX_SITE" || grep -q 'acme-challenge' "$NGINX_SITE" \
  || die "$NGINX_SITE has no port-80 redirect block as in section 5.2; add the ACME location by hand"
body="$(curl -fsS --max-time 10 "http://127.0.0.1:$APP_PORT/api/health" 2>/dev/null || true)"
healthy_body "$body" || die "the app on 127.0.0.1:$APP_PORT is not healthy; fix that first"
resolved="$(getent ahostsv4 "$host" | awk 'NR==1{print $1}')"
[[ -n "$resolved" ]] || die "$host does not resolve yet; IT must add the public DNS record first"
log "app healthy; $host resolves to $resolved"

# 2. certbot ----------------------------------------------------------------------------------
if ! command -v certbot >/dev/null; then
  log "installing certbot (EPEL)"
  dnf install -y epel-release >/dev/null 2>&1 \
    || { dnf config-manager --set-enabled crb >/dev/null 2>&1 || true; dnf install -y epel-release >/dev/null; }
  dnf install -y certbot >/dev/null
fi
log "$(certbot --version 2>&1)"

# 3. ACME path on port 80 (a server-level redirect would run before any location) and the host name
install -d -m 755 "$WEBROOT"
command -v restorecon >/dev/null && restorecon -R "$WEBROOT" || true
tmp="$(mktemp)"
awk -v host="$host" -v webroot="$WEBROOT" '
  $1 == "server_name" && index($0, " " host) == 0 { sub(/;[[:space:]]*$/, " " host ";") }
  index($0, "return 301 https://$host$request_uri;") && !index($0, "location") {
    sub(/return 301 https:\/\/\$host\$request_uri;/,
        "location /.well-known/acme-challenge/ { root " webroot "; }\n    location / { return 301 https://$host$request_uri; }")
  }
  { print }
' "$NGINX_SITE" >"$tmp"
if ! cmp -s "$tmp" "$NGINX_SITE"; then
  apply_nginx "$tmp"
  log "port 80 serves Let's Encrypt checks for $host"
fi
rm -f "$tmp"

probe="hireos-probe-$RANDOM"
install -d -m 755 "$WEBROOT/.well-known/acme-challenge"
echo ok >"$WEBROOT/.well-known/acme-challenge/$probe"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: $host" "http://127.0.0.1/.well-known/acme-challenge/$probe" || true)"
rm -f "$WEBROOT/.well-known/acme-challenge/$probe"
[[ "$code" == 200 ]] || die "nginx does not serve the ACME path for $host (got $code); check $NGINX_SITE"

# 4. Certificate ------------------------------------------------------------------------------
live="/etc/letsencrypt/live/$host"
if [[ ! -f "$live/fullchain.pem" ]]; then
  reg=(--register-unsafely-without-email)
  [[ -n "$email" ]] && reg=(--email "$email")
  certbot certonly --webroot -w "$WEBROOT" -d "$host" --agree-tos --non-interactive "${reg[@]}" \
    || die "Let's Encrypt could not reach http://$host from the internet. IT: public DNS → office IP, ports 80 and 443 forwarded to this server"
fi
install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' >/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
systemctl enable --now certbot-renew.timer >/dev/null 2>&1 || log "WARNING: enable automatic renewal: systemctl enable --now certbot-renew.timer"
log "certificate $live"

# 5. nginx uses the certificate -----------------------------------------------------------------
tmp="$(mktemp)"
awk -v c="$live/fullchain.pem" -v k="$live/privkey.pem" '
  $1 == "ssl_certificate"     { sub(/ssl_certificate[[:space:]].*/, "ssl_certificate     " c ";") }
  $1 == "ssl_certificate_key" { sub(/ssl_certificate_key[[:space:]].*/, "ssl_certificate_key " k ";") }
  { print }
' "$NGINX_SITE" >"$tmp"
if ! cmp -s "$tmp" "$NGINX_SITE"; then apply_nginx "$tmp"; fi
rm -f "$tmp"

body="$(curl -fsS --max-time 10 --resolve "$host:443:127.0.0.1" "https://$host/api/health" || true)"
healthy_body "$body" || die "https://$host does not answer with a valid certificate on this server"
headers="$(curl -fsSI --max-time 10 --resolve "$host:443:127.0.0.1" "https://$host/login" || true)"
grep -qi '^content-security-policy:' <<<"$headers" || die "security headers missing on https://$host/login"
wasm="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$host:443:127.0.0.1" "https://$host/mediapipe/wasm/vision_wasm_internal.js" || true)"
[[ "$wasm" == 200 ]] || log "WARNING: phone camera detection files return $wasm; run 'npm run setup:mediapipe' in $APP_DIR before the rebuild"
log "https://$host OK (trusted certificate, security headers)"

# 6. App URL --------------------------------------------------------------------------------
cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d%H%M%S)"
tmp="$(mktemp)"
awk -v url="https://$host" '
  /^[[:space:]]*NEXT_PUBLIC_APP_URL=/ { print "NEXT_PUBLIC_APP_URL=\"" url "\""; seen=1; next }
  /^[[:space:]]*PUBLIC_HTTPS_URL=/    { print "PUBLIC_HTTPS_URL=\"" url "\""; next }
  { print }
  END { if (!seen) print "NEXT_PUBLIC_APP_URL=\"" url "\"" }
' "$ENV_FILE" >"$tmp"
cat "$tmp" >"$ENV_FILE"
rm -f "$tmp"
log "NEXT_PUBLIC_APP_URL=https://$host in $ENV_FILE (backup kept next to it)"

cat <<EOF

DONE on this server. Still to do:
  1. Rebuild, as the app user:  cd $APP_DIR && bash scripts/deploy-release.sh
  2. From a phone on mobile data, open https://$host/login (proves the internet can reach it).
  3. Staff sign in at https://$host. If it does not open inside the office, IT adds an internal DNS
     record $host → 10.0.12.218.
EOF
