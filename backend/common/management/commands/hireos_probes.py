from django.core.management.base import BaseCommand

from common.views import dumps, run_probe_bundle


class Command(BaseCommand):
    help = "Probe Ollama and the FastAPI speech service (read-only HTTP)."

    def handle(self, *args, **options):
        self.stdout.write(dumps(run_probe_bundle()))
