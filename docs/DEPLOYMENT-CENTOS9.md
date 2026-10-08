# HireOS on CentOS Stream 9 — remaining server setup

For DevOps. The app (Next.js) is already running on the app server and the database is built.
This covers what is still missing: **Ollama (AI)**, **speech (voice)**, **code runner**, **HTTPS**,
**firewall**, **auto-start**, **database hardening**, **backups**, **importing existing resumes** and
**deploying updates without downtime** (section 11 — the only supported way to update the app).

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

    # While the app restarts, show a self-refreshing notice instead of a bare "502 Bad Gateway"
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
```

The app already sends its own security headers (CSP, X-Frame-Options, etc.). Do not add or override them in nginx
(the headers above apply only to nginx's own maintenance page).

### 5.3 SELinux and reload

```bash
sudo setsebool -P httpd_can_network_connect 1    # lets nginx connect to 127.0.0.1:5000
sudo install -m 644 APP_DIR/deploy/nginx/hireos-maintenance.html /usr/share/nginx/html/
sudo restorecon -v /usr/share/nginx/html/hireos-maintenance.html
sudo nginx -t && sudo systemctl reload nginx
```

### 5.4 Django on port 4000

The app does not use Django (all `NEXT_PUBLIC_USE_DJANGO_*` flags are `false`). In the existing nginx server block for Django, change `listen 4000;` to `listen 127.0.0.1:4000;` (or stop it).

### 5.5 App URL

In `APP_DIR/.env`:

```bash
NEXT_PUBLIC_APP_URL="https://10.0.12.218"
```

This is a `NEXT_PUBLIC_*` value, baked in at build time, so deploy again after changing it (section 11).
Never run `npm ci` or `npm run build` in the folder the live app runs from.

### 5.6 Client IP (rate limits)

The careers form and assessment links are rate limited per client IP. The app ignores `X-Forwarded-For` unless told
how many proxies sit in front of it, because any client can send that header. With nginx as the only proxy, in `APP_DIR/.env`:

```bash
TRUST_PROXY=1
```

nginx appends the real client address (`$proxy_add_x_forwarded_for`, section 5.2) and the app reads that last entry.
This is only safe while port 5000 is closed to the network (section 6). If `TRUST_PROXY` is unset, IP limits are
off and the careers form falls back to a per-email limit plus one site-wide limit. Restart the app after changing it.

### 5.7 Resume Parser profile search

The Talent Pool can search the Resume Parser database by skill and add a profile (its resume is downloaded and
read locally). The app calls Resume Parser from the server only. In `APP_DIR/.env`:

```bash
RESUME_PARSER_API_URL="http://<resume-parser-host>:<port>"   # no trailing path, no credentials
RESUME_PARSER_API_KEY="<key issued to HireOS by the Resume Parser team>"
```

Then `sudo systemctl restart hireos-app` (no rebuild needed). Without both values the Talent Pool says
"Resume Parser is not connected yet." The app server must be able to reach that host and port, and the Resume
Parser team must add the host name/IP HireOS uses to their `ALLOWED_HOSTS`. Check from the app server:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "X-API-Key: $RESUME_PARSER_API_KEY" \
  "$RESUME_PARSER_API_URL/api/v1/external/profiles/search/?skills=python&page_size=1"   # 200
```

### 5.8 LogiSoft careers page sync (WordPress)

Applications made on the LogiSoft careers page (WordPress `careers/v1` API) are brought into HireOS: each
careers job becomes a job in Jobs & Candidates (marked "From careers page"), each applicant becomes a candidate
at **Applied** on that job, with the resume and the form answers. An existing candidate (same email) is never
changed; it only gets the new application. Careers jobs that leave the live list are set to **Closed** (people
and history stay). The first import runs no AI; after it, new applicants get advisory AI screening (stage never
changes). It runs every 15 minutes, and HR admins have **Sync now** on Jobs & Candidates.

**One-time database update — do this BEFORE deploying the release that contains it.** It only adds four empty
columns and two indexes (`prisma/manual/20261007_careers_sync.sql`); the running app is not affected and it is
safe to run twice. Take a backup first (`pg_dump`), then as `APP_USER`:

```bash
cd APP_DIR && git pull --ff-only
npx prisma db execute --file prisma/manual/20261007_careers_sync.sql --schema prisma/schema.prisma
# check: 4 rows
psql "<database url without ?schema=…>" -c "SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('Job','Application') AND column_name IN ('externalSource','externalId');"
```

Do not use `prisma db push` or `prisma migrate` for this (see `docs/DEPLOYMENT-DATABASE-V3.1.md`, R-4).

Then in `APP_DIR/.env` (server only, never `NEXT_PUBLIC_*`), deploy (section 11), and restart:

```bash
CAREERS_API_URL="https://logisofttechinc.com"     # site address only; the app adds /wp-json/careers/v1/...
CAREERS_API_KEY="<Bearer key from the WordPress developer>"
# Optional:
# CAREERS_SYNC_INTERVAL_MINUTES=15      # 0 = only "Sync now"; default 15 in production
# CAREERS_ORGANIZATION_ID="<org id>"    # only needed if the database has more than one organization
# AUTO_SCREENING_SWEEP_MINUTES=2        # auto AI screening of unscreened applicants; 0 = off; default 2 in production
```

Without both values nothing runs and the card is hidden. The first sync starts about a minute after the app
starts and imports every live application (about 1,300 at first, so it takes a while); progress shows on the
card. Logs: `sudo journalctl -u hireos-app | grep careers-sync` (counts only, no applicant details). Check the key
from the app server (expect 200):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $CAREERS_API_KEY" \
  "$CAREERS_API_URL/wp-json/careers/v1/live-applications?per_page=1"
```

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

systemd must be the **only** thing that runs the app on port 5000. If it currently runs under pm2,
`nohup` or a terminal, stop that first (`pm2 delete all && pm2 save`, or kill the process).

`/etc/systemd/system/hireos-app.service` — use the file from the repo, `APP_DIR/deploy/systemd/hireos-app.service`.
It runs the app from `/opt/hireos/current` (a fully built release, see section 11), restarts it 3 seconds
after any crash, and never gives up retrying:

```bash
sed 's/APP_USER/<the real user>/' APP_DIR/deploy/systemd/hireos-app.service | sudo tee /etc/systemd/system/hireos-app.service
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

Do the first deploy (section 11, step 2) **before** enabling `hireos-app`, so `/opt/hireos/current` exists. Then:

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

## 10. Importing existing resumes

**Do not copy resume files into the storage folder by hand.** The app only shows a resume that has a
candidate record in the database (file location, extracted text, search embedding). Use the import command.

**Storage folder (one-time).** In `APP_DIR/.env` set `STORAGE_ROOT=/data/hireos/storage`, then:

```bash
sudo mkdir -p /data/hireos/storage
sudo chown -R APP_USER:APP_USER /data/hireos/storage
sudo chmod 750 /data/hireos/storage
sudo systemctl restart hireos-app
```

Keep it outside any folder nginx serves. If the app already stored files in `APP_DIR/storage`, move them
to the new folder before restarting.

**What HR provides:**

1. One folder with the resume files (PDF, DOCX or TXT, max 10 MB each).
2. A CSV (Excel: *Save As → CSV UTF-8*) with this header row, one row per resume
   (template: `docs/resume-import-template.csv`):

| Column | Required | Notes |
|---|---|---|
| `file` | yes | Exact file name in the folder, e.g. `Ravi Kumar CV.pdf` (no folders) |
| `firstName`, `lastName` | yes | |
| `email` | yes | One candidate per email |
| `phone`, `location` | no | |
| `job` | no | Exact job title (or job id) of a job in HireOS. Empty = talent pool only |

**Run it** on the app server as `APP_USER`, from the live release (it uses the app's `.env` and installed packages):

```bash
cd /opt/hireos/current
# 1. Dry run: checks every row and file, writes nothing
npm run import:resumes -- --dir /data/import/resumes --csv /data/import/list.csv
# 2. When the dry run looks right: import (asks you to type the database name)
npm run import:resumes -- --dir /data/import/resumes --csv /data/import/list.csv --apply
```

What it does per row: checks the file is a real PDF/DOCX/TXT, extracts the text locally, creates the
candidate, adds an application at **APPLIED** for the given job (source `bulk_import`), and builds the
Talent Pool search embedding with local Ollama. It never changes an existing candidate (same email): it only
adds the job application. Re-running the same CSV is safe; already-imported rows are skipped. Bad rows are
listed as `SKIP` with the reason and the rest still import. No AI screening runs automatically.

If it reports candidates as "not search-ready" (Ollama was down), run `npm run embed:backfill` later (also from `/opt/hireos/current`).
Scanned (image-only) PDFs import without text; HR can open them in the app. Delete the import folder and CSV
from the server once the import is done.

**Jobs from the careers website.** HireOS is the place where jobs are managed. The 7 listings from the
website (`docs/careers-website-jobs.json`) were imported as **Draft**; HR opens each one (Jobs → job →
Edit Job → Status: Open). To import a new export of website listings (existing titles are skipped, never changed):

```bash
cd /opt/hireos/current
npm run import:jobs -- --file <jobs.json> --created-by <HR admin email>            # dry run
npm run import:jobs -- --file <jobs.json> --created-by <HR admin email> --apply    # asks for the database name
```

## 11. Deploying updates (no downtime, automatic rollback)

**Never update the live folder in place** (`git pull && npm ci && npm run build` while the app runs). That
deletes the running app's files mid-build, the app crashes, and nginx shows **502 Bad Gateway**.

`scripts/deploy-release.sh` does it safely:

1. Checks out the new commit into its own folder `/opt/hireos/releases/<time>-<commit>` (the live app keeps running).
2. Runs `npm ci` and `npm run build` there. If that fails, it stops; the live app is untouched.
3. Starts the new build on `127.0.0.1:5099` and waits until `/api/health` reports the database reachable. If not, it stops; the live app is untouched.
4. Points `/opt/hireos/current` at the new release and restarts `hireos-app` (a few seconds; nginx shows the maintenance page meanwhile).
5. If the restarted app is not healthy within 2 minutes, it points `current` back at the previous release and restarts again.
6. Keeps the last 3 releases. Logs: `/opt/hireos/releases/<release>.build.log` and `.smoke.log`.

All releases share `APP_DIR/.env` (symlinked), so `STORAGE_ROOT` **must** be an absolute path
(`/data/hireos/storage`, section 10) — the script refuses to deploy otherwise.

**One-time setup** (as root unless noted):

```bash
# 1. Folders and a sudo rule that lets APP_USER restart only the app
sudo mkdir -p /opt/hireos && sudo chown APP_USER:APP_USER /opt/hireos
echo 'APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart hireos-app' | sudo tee /etc/sudoers.d/hireos-deploy
sudo chmod 440 /etc/sudoers.d/hireos-deploy && sudo visudo -cf /etc/sudoers.d/hireos-deploy

# 2. As APP_USER: get the script and build the first release (does not restart anything)
cd APP_DIR && git pull --ff-only && bash scripts/deploy-release.sh --no-restart

# 3. Switch the service to /opt/hireos/current (section 7) and the nginx maintenance page (sections 5.2, 5.3)
sudo systemctl daemon-reload && sudo systemctl enable hireos-app && sudo systemctl restart hireos-app
curl -s http://127.0.0.1:5000/api/health      # "database":{"ok":true}
```

**Every update after that** (as `APP_USER`):

```bash
cd APP_DIR && bash scripts/deploy-release.sh              # latest GitLab fe
cd APP_DIR && bash scripts/deploy-release.sh --rollback   # undo: back to the previous release
```

After changing `APP_DIR/.env`: non-`NEXT_PUBLIC_*` values only need `sudo systemctl restart hireos-app`;
`NEXT_PUBLIC_*` values need a deploy (they are baked in at build time).

If the app is down: `sudo systemctl status hireos-app --no-pager` and `sudo journalctl -u hireos-app -n 100 --no-pager`.

## 12. Final check

On the app server:

```bash
curl -s http://127.0.0.1:11434/api/tags      # Ollama: both models
curl -s http://127.0.0.1:8001/health         # speech
curl -s http://127.0.0.1:8010/health         # code runner
curl -sk https://10.0.12.218/api/health      # {"ok":true,...,"ollama":{"ok":true},"speech":{"ok":true}}
```

From another PC: `https://10.0.12.218/login` opens, sign-in reaches the dashboard, and `http://10.0.12.218:5000`, `:4000`, `:8010`, `:11434`, `:8001` are **not** reachable.
