#!/usr/bin/env bash
# Publish HireOS at https://<hostname> through a Cloudflare Tunnel (no VPN, no open inbound ports).
# The app, database and AI stay on this server; cloudflared only makes an outbound connection.
#
#   sudo bash scripts/setup-cloudflare-tunnel.sh hireos.example.com
#
# Prerequisite: in the Cloudflare dashboard (Zero Trust → Networks → Tunnels) a tunnel with a
# public hostname <hostname> → service HTTPS 127.0.0.1:443, TLS "No TLS Verify" on. The script asks
# for that tunnel's token (or reads CLOUDFLARED_TOKEN). See docs/DEPLOYMENT-CENTOS9.md section 13.
#
# Order: checks → nginx entry for the tunnel → cloudflared service → public URL check →
# NEXT_PUBLIC_APP_URL in .env (only once the public URL works). Rebuild afterwards (section 11).
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="$APP_DIR/.env"
APP_PORT="${APP_PORT:-5000}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/conf.d/hireos.conf}"
TUNNEL_SITE="/etc/nginx/conf.d/hireos-tunnel.conf"
TOKEN_FILE="/etc/cloudflared/hireos-tunnel.env"
UNIT_FILE="/etc/systemd/system/hireos-tunnel.service"

log() { printf '[tunnel %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { log "FAILED: $*"; exit 1; }

host="${1:-}"
[[ "$host" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]] \
  || die "usage: sudo bash scripts/setup-cloudflare-tunnel.sh <hostname, e.g. hireos.example.com>"
[[ $EUID -eq 0 ]] || die "run with sudo"

healthy_body() { [[ "$1" == *'"database":{"ok":true}'* ]]; }

# 1. Checks -------------------------------------------------------------------------------
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found (set APP_DIR=/path/to/app)"
command -v nginx >/dev/null || die "nginx is not installed (section 5)"
[[ -f "$NGINX_SITE" ]] || die "$NGINX_SITE not found (section 5.2)"
cert="${CERT:-$(awk '$1=="ssl_certificate"{gsub(";","",$2); print $2; exit}' "$NGINX_SITE")}"
key="${KEY:-$(awk '$1=="ssl_certificate_key"{gsub(";","",$2); print $2; exit}' "$NGINX_SITE")}"
[[ -n "$cert" && -f "$cert" && -n "$key" && -f "$key" ]] \
  || die "could not find the certificate/key used in $NGINX_SITE (set CERT= and KEY=)"
body="$(curl -fsS --max-time 10 "http://127.0.0.1:$APP_PORT/api/health" 2>/dev/null || true)"
healthy_body "$body" || die "the app on 127.0.0.1:$APP_PORT is not healthy; fix that first"
log "app healthy, certificate $cert"

# 2. nginx entry for the tunnel (127.0.0.1 only, so only cloudflared on this server reaches it) ----
# CF-Connecting-IP is set by Cloudflare to the visitor's address; it is trusted here only because
# nothing but the local tunnel can connect to this listener. TRUST_PROXY=1 stays correct.
if [[ -f "$TUNNEL_SITE" ]]; then cp -p "$TUNNEL_SITE" "$TUNNEL_SITE.bak-$(date +%Y%m%d%H%M%S)"; fi
cat >"$TUNNEL_SITE" <<EOF
# HireOS public entry via Cloudflare Tunnel. Written by scripts/setup-cloudflare-tunnel.sh.
server {
    listen 127.0.0.1:443 ssl;
    server_name $host;

    ssl_certificate     $cert;
    ssl_certificate_key $key;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 50m;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$http_cf_connecting_ip;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    error_page 502 503 504 /hireos-maintenance.html;
    location = /hireos-maintenance.html {
        root /usr/share/nginx/html;
        internal;
        add_header Cache-Control "no-store" always;
        add_header Content-Security-Policy "default-src 'none'" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
    }
}
EOF
if ! nginx -t >/dev/null 2>&1; then
  nginx -t || true
  rm -f "$TUNNEL_SITE"
  die "nginx rejected the tunnel config; removed it, nothing else changed"
fi
systemctl reload nginx
body="$(curl -sk --max-time 10 --resolve "$host:443:127.0.0.1" "https://$host/api/health" || true)"
healthy_body "$body" || die "nginx tunnel entry does not reach the app (check $TUNNEL_SITE)"
log "nginx tunnel entry OK ($TUNNEL_SITE)"

# 3. cloudflared ------------------------------------------------------------------------------
if ! command -v cloudflared >/dev/null; then
  log "installing cloudflared from Cloudflare's package repository"
  curl -fsSL https://pkg.cloudflare.com/cloudflared-ascii.repo -o /etc/yum.repos.d/cloudflared.repo
  dnf install -y cloudflared >/dev/null
fi
cf_bin="$(command -v cloudflared)"
log "$("$cf_bin" --version | head -n1)"

token="${CLOUDFLARED_TOKEN:-}"
if [[ -z "$token" ]]; then
  read -rsp "Paste the tunnel token (input hidden): " token
  echo
fi
token="$(printf '%s' "$token" | tr -d '[:space:]')"
[[ "$(printf '%s' "$token" | base64 -d 2>/dev/null || true)" == *'"t":'* ]] \
  || die "that is not a Cloudflare tunnel token (copy it from the tunnel's install command)"

install -d -m 700 /etc/cloudflared
(umask 077; printf 'TUNNEL_TOKEN=%s\n' "$token" >"$TOKEN_FILE")
unset token CLOUDFLARED_TOKEN

cat >"$UNIT_FILE" <<EOF
# Cloudflare Tunnel for HireOS. Written by scripts/setup-cloudflare-tunnel.sh.
[Unit]
Description=Cloudflare Tunnel for HireOS
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
EnvironmentFile=$TOKEN_FILE
ExecStart=$cf_bin --no-autoupdate --metrics 127.0.0.1:20241 tunnel run
Restart=always
RestartSec=5
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable hireos-tunnel >/dev/null 2>&1
started="$(date '+%Y-%m-%d %H:%M:%S')"
systemctl restart hireos-tunnel

connected=0
for _ in $(seq 1 30); do
  if journalctl -u hireos-tunnel --since "$started" --no-pager 2>/dev/null | grep -q "Registered tunnel connection"; then
    connected=1; break
  fi
  sleep 2
done
((connected)) || { journalctl -u hireos-tunnel -n 20 --no-pager || true; die "tunnel did not connect to Cloudflare (outbound port 7844 TCP/UDP blocked by the company firewall, or wrong token)"; }
log "tunnel connected (service hireos-tunnel)"

# 4. Public URL check ---------------------------------------------------------------------------
ok=0
for _ in $(seq 1 30); do
  body="$(curl -fsS --max-time 15 "https://$host/api/health" 2>/dev/null || true)"
  if healthy_body "$body"; then ok=1; break; fi
  sleep 4
done
((ok)) || die "https://$host/api/health is not answering yet. Check the tunnel's public hostname in Cloudflare (service https://127.0.0.1:443, No TLS Verify on) and DNS, then run this again"
log "https://$host/api/health OK"

login_html="$(curl -fsS --max-time 15 "https://$host/login" || true)"
headers="$(curl -fsSI --max-time 15 "https://$host/login" || true)"
grep -qi '^content-security-policy:' <<<"$headers" || die "security headers missing on https://$host/login"
if grep -Eq 'cdn-cgi/|cloudflareinsights|rocket-loader' <<<"$login_html"; then
  die "Cloudflare is injecting scripts into pages. Turn off Rocket Loader, Email Address Obfuscation, Web Analytics auto-setup and Bot Fight Mode for this domain, then run this again"
fi
wasm="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$host/mediapipe/wasm/vision_wasm_internal.js" || true)"
[[ "$wasm" == 200 ]] || log "WARNING: phone camera detection files return $wasm; run 'npm run setup:mediapipe' in $APP_DIR before the rebuild"
log "pages, security headers and Cloudflare settings OK"

# 5. App URL --------------------------------------------------------------------------------
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

DONE. HireOS answers at https://$host

Still to do:
  1. Rebuild so emails and links use the new address, as the app user:
       cd $APP_DIR && bash scripts/deploy-release.sh
  2. Tell staff to open https://$host (not https://10.0.12.218). Interview and assessment links
     they copy use the address in their browser.
EOF
