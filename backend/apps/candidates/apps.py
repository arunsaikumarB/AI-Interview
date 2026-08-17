from django.apps import AppConfig


class CandidatesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.candidates"
    label = "candidates"
    verbose_name = "Candidates"
