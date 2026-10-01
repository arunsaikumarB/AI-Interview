# HireOS on CentOS Stream 9 — remaining server setup

For DevOps. The app (Next.js) is already running on the app server and the database is built.
This covers what is still missing: **Ollama (AI)**, **speech (voice)**, **code runner**, **HTTPS**,
**firewall**, **auto-start**, **database hardening** and **backups**.

| Server | Role |
|---|---|
| `10.0.12.218` (app server) | nginx (HTTPS) → Next.js `:5000`; Ollama `:11434`, speech `:8001`, code runner `:8010` — all internal |
| `10.0.12.219` (DB server) | PostgreSQL 17 + pgvector `:5432` |

Replace these placeholders everywhere below:

- `APP_DIR` = folder of the deployed app (the GitLab `fe` checkout), e.g. `/opt/hireos/app`
- `APP_USER` = Linux user that runs the app, e.g. `hireos`

> **Never run on the server:** `npm run dev`, `npm run db:seed`, `prisma db push`, `prisma migrate …`,
> `python manage.py migrate`. The database schema is already built and verified.

---

## 1. Docker (needed by Ollama, speech and the code runner)

CentOS 9 ships Podman by default. The code runner calls the real `docker` CLI and `docker compose`, so install Docker CE:

```bash
sudo dnf remove -y podman buildah runc docker docker-client docker-common 2>/dev/null || true
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker APP_USER     # APP_USER must log out and back in afterwards
docker compose version               # must print a version
```

> **Important:** ports published by Docker bypass firewalld. Every `-p` below is bound to `127.0.0.1`
> on purpose. Never publish these services as `-p 11434:11434` (that would expose them to the network).

## 2. Ollama (AI) and how the app uses it

### 2.1 Hardware

| Model | Download | RAM | Used for |
|---|---|---|---|
| `qwen2.5:7b` | ~4.7 GB | ~8 GB | AI screening, interview questions, answer evaluation, assessment generation |
| `nomic-embed-text` | ~0.3 GB | ~1 GB | Talent Pool search (embeddings, stored in pgvector) |

Minimum 16 GB RAM and 8 CPU cores. CPU-only works but each AI reply can take 20–60 s; an NVIDIA GPU (8 GB+ VRAM) makes interviews feel live.

### 2.2 Install (Docker, recommended)

```bash
docker volume create hireos_ollama_data
docker run -d --name hireos-ollama --restart unless-stopped \
  -p 127.0.0.1:11434:11434 \
  -v hireos_ollama_data:/root/.ollama \
  ollama/ollama:latest

docker exec hireos-ollama ollama pull qwen2.5:7b
docker exec hireos-ollama ollama pull nomic-embed-text
docker exec hireos-ollama ollama list          # both models listed
curl -s http://127.0.0.1:11434/api/tags        # JSON with both models
```

With an NVIDIA GPU: install the NVIDIA driver and `nvidia-container-toolkit`, then add `--gpus all` to the `docker run` line.

Models are downloaded once from the Ollama registry; after that everything runs locally (no cloud AI).

### 2.3 Integration (app `.env`)

These lines in `APP_DIR/.env` connect the app to Ollama. Keep them exactly like this:

```bash
AI_PROVIDER="local"
OLLAMA_LOCAL_URL="http://127.0.0.1:11434"
OLLAMA_MODEL="qwen2.5:7b"
OLLAMA_CHAT_MODEL="qwen2.5:7b"
OLLAMA_EMBED_MODEL="nomic-embed-text"
```

- If Ollama runs on a **different** server, set `OLLAMA_LOCAL_URL="http://<that-server-ip>:11434"`, publish it there with `-p <that-server-ip>:11434:11434`, and allow port 11434 **only from 10.0.12.218** in that server's firewall.
- The app waits up to 240 s for an AI reply (`OLLAMA_TIMEOUT_MS`, default `240000`). nginx must allow this (section 5).
- AI is advisory only: if Ollama is down, the app shows an honest error, never a fake score, and never changes a candidate's stage.

Restart the app after editing `.env` (section 7). These are not `NEXT_PUBLIC_*` values, so no rebuild is needed.

## 3. Speech service (voice interviews)

Speech-to-text (faster-whisper) and text-to-speech (Piper) run locally. Docker is used because the service needs `ffmpeg`, which is not in the standard CentOS repos.

```bash
cd APP_DIR
docker build -t hireos-speech:v1 ./speech-service
docker volume create hireos_speech_cache
docker run -d --name hireos-speech --restart unless-stopped \
  -p 127.0.0.1:8001:8001 \
  -e WHISPER_MODEL=small -e WHISPER_MODEL_CPU=small \
  -v hireos_speech_cache:/root/.cache/huggingface \
  hireos-speech:v1

curl -s http://127.0.0.1:8001/health
```

The Whisper model is downloaded on first use and cached in the volume. App `.env`:

```bash
SPEECH_SERVICE_URL="http://127.0.0.1:8001"
```

## 4. Code runner (Coding / SQL assessments)

The runner executes candidate code inside locked-down, throwaway Docker containers. Next.js talks to it on `127.0.0.1:8010` only.

```bash
sudo dnf install -y python3 python3-pip
cd APP_DIR
# The runner expects its Python at backend/.venv (the fe branch has no backend code; this folder is just the venv)
python3 -m venv backend/.venv
backend/.venv/bin/pip install "psycopg[binary]>=3.2,<3.3"

# As APP_USER (must be in the docker group): generates secrets, builds the sandbox image,
# starts the SQL sandbox container on 127.0.0.1:55433, adds SANDBOX_RUNNER_URL/SECRET to .env
npm run sandbox:setup
```

Then run the runner as a service (section 7) and check:

```bash
curl -s http://127.0.0.1:8010/health
```

Do not change `SANDBOX_RUNNER_URL` away from `127.0.0.1`, and never open port 8010 in the firewall.

## 5. HTTPS with nginx (required)

Without HTTPS the browser drops the secure login cookie (users bounce back to the login page) and blocks camera/microphone. nginx is already installed.

### 5.1 Certificate

Use a certificate from the company CA if available. Otherwise a self-signed one (browsers show a warning once):

```bash
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout /etc/nginx/ssl/hireos.key -out /etc/nginx/ssl/hireos.crt \
  -subj "/CN=10.0.12.218" -addext "subjectAltName=IP:10.0.12.218"
sudo chmod 600 /etc/nginx/ssl/hireos.key
sudo restorecon -Rv /etc/nginx/ssl
```

If candidates will join from **outside** the office, use a public domain name and a real certificate (e.g. Let's Encrypt) instead.

### 5.2 Site config — `/etc/nginx/conf.d/hireos.conf`

```nginx
server {
    listen 80;
    server_name 10.0.12.218;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name 10.0.12.218;

    ssl_certificate     /etc/nginx/ssl/hireos.crt;
    ssl_certificate_key /etc/nginx/ssl/hireos.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 50m;        # resumes 10 MB, voice answers up to 25 MB
    proxy_read_timeout 300s;         # AI replies can take up to 240 s
    proxy_send_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

The app already sends its own security headers (CSP, X-Frame-Options, etc.). Do not add or override them in nginx.

### 5.3 SELinux and reload

```bash
sudo setsebool -P httpd_can_network_connect 1    # lets nginx connect to 127.0.0.1:5000
sudo nginx -t && sudo systemctl reload nginx
```

### 5.4 Django on port 4000

The app does not use Django (all `NEXT_PUBLIC_USE_DJANGO_*` flags are `false`). In the existing nginx server block for Django, change `listen 4000;` to `listen 127.0.0.1:4000;` (or stop it).

### 5.5 App URL

In `APP_DIR/.env`:

```bash
NEXT_PUBLIC_APP_URL="https://10.0.12.218"
```

This is a `NEXT_PUBLIC_*` value, baked in at build time, so rebuild: `cd APP_DIR && npm run build`, then restart the app (section 7).

## 6. Firewall (app server)

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --remove-port=5000/tcp
sudo firewall-cmd --permanent --remove-port=4000/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-all       # only ssh, http, https should be open
```

Next.js listens on all interfaces (`npm run start` uses `-H 0.0.0.0`), so the firewall is what keeps port 5000 internal. Do not start it with `-H 127.0.0.1`: that makes its redirects point to the internal port.

## 7. Auto-start with systemd

If the app already runs under pm2, keep pm2 for the app and add only the runner. Otherwise:

`/etc/systemd/system/hireos-app.service`

```ini
[Unit]
Description=HireOS Next.js app
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=APP_USER
WorkingDirectory=APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start -- -p 5000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/hireos-runner.service`

```ini
[Unit]
Description=HireOS code runner (127.0.0.1:8010)
After=docker.service
Requires=docker.service

[Service]
User=APP_USER
WorkingDirectory=APP_DIR
ExecStart=/usr/bin/node scripts/start-sandbox-runner.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

If Node.js was not installed from the system packages, replace `/usr/bin/npm` and `/usr/bin/node` with the output of `which npm` and `which node` (run as `APP_USER`).

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now hireos-app hireos-runner
sudo systemctl status hireos-app hireos-runner --no-pager
```

The Ollama, speech and SQL sandbox containers restart by themselves (`--restart unless-stopped`) because Docker is enabled at boot.

## 8. Database server (10.0.12.219)

```sql
-- as postgres superuser
ALTER ROLE logisoft_hire PASSWORD '<new strong password>';
ALTER ROLE logisoft_hire NOSUPERUSER;
```

Then update `DATABASE_URL` in `APP_DIR/.env` (URL-encode special characters, e.g. `@` → `%40`) and restart the app.

Allow connections only from the app server — `pg_hba.conf`:

```text
host  logisoft_hire_db  logisoft_hire  10.0.12.218/32  scram-sha-256
```

(remove broader `host … 0.0.0.0/0` or `10.0.0.0/8` lines for this database), reload PostgreSQL, and in firewalld:

```bash
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="10.0.12.218/32" port port="5432" protocol="tcp" accept'
sudo firewall-cmd --permanent --remove-service=postgresql 2>/dev/null; sudo firewall-cmd --permanent --remove-port=5432/tcp 2>/dev/null
sudo firewall-cmd --reload
```

## 9. Backups

Daily, kept on another machine:

```bash
pg_dump --format=custom --no-owner --file=/backup/hireos_$(date +%F).dump \
  "postgresql://logisoft_hire:<password>@10.0.12.219:5432/logisoft_hire_db"
tar -czf /backup/hireos_storage_$(date +%F).tar.gz -C /data/hireos storage
```

The database references files in `/data/hireos/storage` (resumes, recordings), so always back up both together. Test a restore into a scratch database before relying on it.

## 10. Final check

On the app server:

```bash
curl -s http://127.0.0.1:11434/api/tags      # Ollama: both models
curl -s http://127.0.0.1:8001/health         # speech
curl -s http://127.0.0.1:8010/health         # code runner
curl -sk https://10.0.12.218/api/health      # {"ok":true,...,"ollama":{"ok":true},"speech":{"ok":true}}
```

From another PC: `https://10.0.12.218/login` opens, sign-in reaches the dashboard, and `http://10.0.12.218:5000`, `:4000`, `:8010`, `:11434`, `:8001` are **not** reachable.
