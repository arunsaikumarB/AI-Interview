"""Celery app for HireOS Phase 1. Workers are optional until Redis is running."""
import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("hireos")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
