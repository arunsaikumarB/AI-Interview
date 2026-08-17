"""
HireOS Django Phase 1 settings.

Connects to the SAME PostgreSQL instance Prisma uses.
Does not define models for Prisma tables. Django contrib migrations
only create django_* / auth_* tables, never ALTER Prisma "User"/Job/etc.
"""
from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent
REPO_ROOT = BASE_DIR.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, ["127.0.0.1", "localhost"]),
    DJANGO_CORS_ALLOWED_ORIGINS=(
        list,
        ["http://127.0.0.1:3000", "http://localhost:3000"],
    ),
    DJANGO_CSRF_TRUSTED_ORIGINS=(
        list,
        ["http://127.0.0.1:3000", "http://localhost:3000"],
    ),
)

# Repo-root .env first (shared DATABASE_URL), then backend/.env overrides.
environ.Env.read_env(REPO_ROOT / ".env", overwrite=False)
environ.Env.read_env(BASE_DIR / ".env", overwrite=True)

SECRET_KEY = env("DJANGO_SECRET_KEY", default="")
if not SECRET_KEY:
    raise RuntimeError(
        "DJANGO_SECRET_KEY is not set. Copy backend/.env.example to backend/.env"
    )

DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.postgres",
    "rest_framework",
    "corsheaders",
    "rest_framework_simplejwt",
    "apps.accounts.apps.AccountsConfig",
    "apps.jobs.apps.JobsConfig",
    "apps.candidates.apps.CandidatesConfig",
    "apps.applications.apps.ApplicationsConfig",
    "apps.interviews.apps.InterviewsConfig",
    "apps.screening.apps.ScreeningConfig",
    "apps.proctoring.apps.ProctoringConfig",
    "apps.files.apps.FilesConfig",
    "common.apps.CommonConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    }
]

# Existing HireOS Postgres (Prisma). Strip Prisma's ?schema=public — Django uses search_path public.
_db_url = env("DATABASE_URL", default="")
if not _db_url:
    raise RuntimeError("DATABASE_URL is not set (needed to reach the existing Postgres).")
_clean = _db_url.split("?", 1)[0]
DATABASES = {"default": environ.Env.db_url_config(_clean)}
DATABASES["default"]["ATOMIC_REQUESTS"] = False
DATABASES["default"]["CONN_MAX_AGE"] = 0
DATABASES["default"].setdefault("OPTIONS", {})
DATABASES["default"]["OPTIONS"]["connect_timeout"] = 5

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = env("DJANGO_CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env("DJANGO_CSRF_TRUSTED_ORIGINS")
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_HTTPONLY = True
if not DEBUG:
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_SECURE = True

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "apps.accounts.authentication.HireOSJWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.AllowAny",
    ),
    # Maps Redis/Celery-broker outages to a clean 503 instead of leaking an
    # unhandled 500 (a full DEBUG traceback when DEBUG is on). Everything else
    # falls through to DRF's default handler unchanged.
    "EXCEPTION_HANDLER": "common.exception_handlers.hireos_exception_handler",
}

# Existing Next.js session JWT — do not mint a parallel token format.
AUTH_SECRET = env("AUTH_SECRET", default="")
AUTH_COOKIE_NAME = env("AUTH_COOKIE_NAME", default="aros_session")
AUTH_TOKEN_TTL_HOURS = env.int("AUTH_TOKEN_TTL_HOURS", default=12)
HIREOS_ENFORCE_PRISMA_USER_STATUS = env.bool(
    "HIREOS_ENFORCE_PRISMA_USER_STATUS", default=True
)
HIREOS_IDENTITY_DIRECTORY = env(
    "HIREOS_IDENTITY_DIRECTORY",
    default="apps.accounts.directory.PrismaUserDirectory",
)

# Unused by Phase 2 (HireOS JWT is AUTH_SECRET). Kept so the package stays installed.
SIMPLE_JWT = {
    "ALGORITHM": "HS256",
    "SIGNING_KEY": env("DJANGO_JWT_SIGNING_KEY", default=SECRET_KEY),
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=12),
    "AUTH_HEADER_TYPES": ("Bearer",),
}

REDIS_URL = env("REDIS_URL", default="redis://127.0.0.1:6379/0")
CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
CELERY_TASK_ALWAYS_EAGER = False
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_TIME_LIMIT = env.int("CELERY_TASK_TIME_LIMIT", default=360)
CELERY_TASK_SOFT_TIME_LIMIT = env.int("CELERY_TASK_SOFT_TIME_LIMIT", default=330)
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"

# Resume processing (Phase 3D). Align embed timeout with Next.js OLLAMA_TIMEOUT_MS (240s).
RESUME_MAX_BYTES = 10 * 1024 * 1024
RESUME_PARSE_TIMEOUT_SECONDS = env.int("RESUME_PARSE_TIMEOUT_SECONDS", default=90)
OLLAMA_EMBED_TIMEOUT_SECONDS = env.int(
    "OLLAMA_EMBED_TIMEOUT_SECONDS",
    default=env.int("OLLAMA_TIMEOUT_MS", default=240_000) // 1000,
)
RESUME_LOCK_TTL_SECONDS = env.int("RESUME_LOCK_TTL_SECONDS", default=600)
RESUME_STATUS_TTL_SECONDS = env.int("RESUME_STATUS_TTL_SECONDS", default=86_400)
RESUME_EMBED_MAX_CHARS = 6000
RESUME_EMBED_DIMS = 768
RESUME_PROCESS_MAX_RETRIES = env.int("RESUME_PROCESS_MAX_RETRIES", default=4)

SCREENING_LOCK_TTL_SECONDS = env.int("SCREENING_LOCK_TTL_SECONDS", default=900)
SCREENING_STATUS_TTL_SECONDS = env.int("SCREENING_STATUS_TTL_SECONDS", default=86_400)
SCREENING_PROCESS_TIMEOUT_SECONDS = env.int(
    "SCREENING_PROCESS_TIMEOUT_SECONDS", default=540
)
SCREENING_PROCESS_MAX_RETRIES = env.int("SCREENING_PROCESS_MAX_RETRIES", default=3)

INTERVIEW_LOCK_TTL_SECONDS = env.int("INTERVIEW_LOCK_TTL_SECONDS", default=900)
INTERVIEW_STATUS_TTL_SECONDS = env.int("INTERVIEW_STATUS_TTL_SECONDS", default=86_400)
INTERVIEW_PLAN_TIMEOUT_SECONDS = env.int("INTERVIEW_PLAN_TIMEOUT_SECONDS", default=240)
INTERVIEW_FINALIZE_TIMEOUT_SECONDS = env.int(
    "INTERVIEW_FINALIZE_TIMEOUT_SECONDS", default=240
)
INTERVIEW_TTS_TIMEOUT_SECONDS = env.int("INTERVIEW_TTS_TIMEOUT_SECONDS", default=90)
INTERVIEW_PROCESS_MAX_RETRIES = env.int("INTERVIEW_PROCESS_MAX_RETRIES", default=3)

PROCTORING_LOCK_TTL_SECONDS = env.int("PROCTORING_LOCK_TTL_SECONDS", default=900)
PROCTORING_STATUS_TTL_SECONDS = env.int("PROCTORING_STATUS_TTL_SECONDS", default=86_400)
PROCTORING_PROCESS_MAX_RETRIES = env.int("PROCTORING_PROCESS_MAX_RETRIES", default=3)

AI_PROVIDER = env("AI_PROVIDER", default="local")
OLLAMA_LOCAL_URL = env("OLLAMA_LOCAL_URL", default="http://localhost:11434").rstrip("/")
OLLAMA_CLOUD_URL = env("OLLAMA_CLOUD_URL", default="https://ollama.com").rstrip("/")
OLLAMA_API_KEY = env("OLLAMA_API_KEY", default="")
OLLAMA_CHAT_MODEL = env("OLLAMA_CHAT_MODEL", default="") or env(
    "OLLAMA_MODEL", default="qwen2.5:7b"
)
OLLAMA_EMBED_MODEL = env("OLLAMA_EMBED_MODEL", default="nomic-embed-text")
SPEECH_SERVICE_URL = env("SPEECH_SERVICE_URL", default="http://localhost:8001").rstrip("/")


def _hireos_storage_root() -> str:
    """Match Next.js: repo-root ./storage unless STORAGE_ROOT is absolute."""
    raw = env("STORAGE_ROOT", default="./storage")
    path = Path(raw)
    if path.is_absolute():
        return str(path.resolve())
    return str((REPO_ROOT / "storage").resolve())


STORAGE_ROOT = _hireos_storage_root()
