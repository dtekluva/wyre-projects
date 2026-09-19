"""Wyre Tracker backend — standalone Django project (spec §9, §10).
Configuration comes from backend/.env (see .env.example); nothing secret lives in this file."""
from __future__ import annotations

import os
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlparse, unquote, parse_qs

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-insecure-key")
DEBUG = os.environ.get("DEBUG", "0") == "1"
ALLOWED_HOSTS = [h for h in os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "tracker",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # serves STATIC_ROOT itself; with DEBUG=0 nothing else does, and the admin would come up unstyled
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
WSGI_APPLICATION = "config.wsgi.application"


# libpq keywords worth honouring from the URL's query string. A managed cluster hands you a URL ending
# in ?sslmode=require and refuses plaintext, so dropping the query string here is not cosmetic.
_LIBPQ_OPTS = ("sslmode", "sslrootcert", "sslcert", "sslkey", "connect_timeout", "target_session_attrs")


def _database_from_url(url: str) -> dict:
    u = urlparse(url)
    if u.scheme.startswith("postgres"):
        q = parse_qs(u.query)
        options = {k: q[k][0] for k in _LIBPQ_OPTS if q.get(k)}
        return {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": u.path.lstrip("/"),
            "USER": unquote(u.username or ""),
            "PASSWORD": unquote(u.password or ""),
            "HOST": u.hostname or "localhost",
            "PORT": str(u.port or 5432),
            "CONN_MAX_AGE": 60,
            "OPTIONS": options,
        }
    if u.scheme == "sqlite":
        return {"ENGINE": "django.db.backends.sqlite3", "NAME": str(BASE_DIR / (u.path.lstrip("/") or "db.sqlite3"))}
    raise RuntimeError(f"Unsupported DATABASE_URL scheme: {u.scheme}")


DATABASES = {"default": _database_from_url(os.environ.get("DATABASE_URL", "sqlite:///db.sqlite3"))}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "tracker.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
]

LANGUAGE_CODE = "en-gb"
TIME_ZONE = "Africa/Lagos"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", BASE_DIR / "media"))
FILE_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024

# Uploads (spec §9): object storage with signed URLs, originals never overwritten, sha256 stored.
# Set SPACES_BUCKET to use DigitalOcean Spaces; leave it unset and uploads go to MEDIA_ROOT on disk.
SPACES_BUCKET = os.environ.get("SPACES_BUCKET", "").strip()
SPACES_REGION = os.environ.get("SPACES_REGION", "fra1").strip()
SPACES_ENDPOINT = os.environ.get("SPACES_ENDPOINT", f"https://{SPACES_REGION}.digitaloceanspaces.com").strip()
# seconds a pre-signed download link stays valid
SPACES_URL_EXPIRY = int(os.environ.get("SPACES_URL_EXPIRY", "900"))

if SPACES_BUCKET:
    STORAGES = {
        "default": {
            "BACKEND": "tracker.storage.ContentAddressedS3Storage",
            "OPTIONS": {
                "bucket_name": SPACES_BUCKET,
                "region_name": SPACES_REGION,
                "endpoint_url": SPACES_ENDPOINT,
                "access_key": os.environ.get("SPACES_KEY", ""),
                "secret_key": os.environ.get("SPACES_SECRET", ""),
                # private bucket: every read goes out as a short-lived signed URL
                "default_acl": None,
                "querystring_auth": True,
                "querystring_expire": SPACES_URL_EXPIRY,
                # keys are the sha256 of the bytes, so re-writing a key writes identical content
                "file_overwrite": True,
                "signature_version": "s3v4",
            },
        },
        "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
    }
else:
    STORAGES = {
        "default": {"BACKEND": "tracker.storage.ContentAddressedFileSystemStorage"},
        "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
    }

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework_simplejwt.authentication.JWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_PARSER_CLASSES": ("rest_framework.parsers.JSONParser", "rest_framework.parsers.MultiPartParser", "rest_framework.parsers.FormParser"),
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
    "EXCEPTION_HANDLER": "tracker.errors.exception_handler",
    "UNAUTHENTICATED_USER": None,
}
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=12),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),
    "ROTATE_REFRESH_TOKENS": False,
    "UPDATE_LAST_LOGIN": True,
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

# --- Email channel for §8 alerts (Mailgun). Unset MAILGUN_API_KEY and the digest command simply reports
# what it would have sent, so nothing leaves the building by accident.
MAILGUN_API_KEY = os.environ.get("MAILGUN_API_KEY", "").strip()
MAILGUN_DOMAIN = os.environ.get("MAILGUN_DOMAIN", "mg.wyreng.com").strip()
MAILGUN_BASE = os.environ.get("MAILGUN_BASE", "https://api.mailgun.net/v3").strip()
MAILGUN_FROM = os.environ.get("MAILGUN_FROM", "Wyre Tracker <postmaster@mg.wyreng.com>").strip()
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:5174").rstrip("/")

# --- Behind a TLS-terminating nginx (spec §10). Without the proxy header Django believes every request
# arrived over plain http, builds http:// absolute URLs and rejects the admin's own CSRF token.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
CSRF_TRUSTED_ORIGINS = [o for o in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",") if o]
if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "0"))  # raise once TLS is proven
    SECURE_HSTS_INCLUDE_SUBDOMAINS = False
    X_FRAME_OPTIONS = "DENY"
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"

# Same-origin deployments (app and API behind one nginx) send no Origin header worth checking, so this
# list stays empty there; it exists for the split-origin dev setup.
CORS_ALLOWED_ORIGINS = [o for o in os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o]
CORS_ALLOW_CREDENTIALS = False
if DEBUG:
    CORS_ALLOWED_ORIGIN_REGEXES = [r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"]  # any local dev port

LOGGING = {
    "version": 1, "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "WARNING"},
}
