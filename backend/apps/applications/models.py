"""Read-only Prisma `"Application"` mirror. managed = False.

Org lives on Job, not Application. No recruiter-owner, rejection note, or
decision columns on this table — those live on TimelineEvent / stage enum.
"""

from django.db import models

from apps.candidates.models import Candidate
from apps.jobs.models import Job

PIPELINE_STAGES = (
    "APPLIED",
    "SCREENING",
    "SHORTLISTED",
    "ASSESSMENT",
    "AI_INTERVIEW",
    "TECH_INTERVIEW",
    "HR_INTERVIEW",
    "SELECTED",
    "REJECTED",
)

PIPELINE_FLOW = PIPELINE_STAGES[:7]
TERMINAL_STAGES = ("SELECTED", "REJECTED")

APPLICATION_STATUSES = (
    "ACTIVE",
    "WITHDRAWN",
    "HIRED",
    "REJECTED",
    "ON_HOLD",
)


class Application(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    candidate = models.ForeignKey(
        Candidate,
        on_delete=models.DO_NOTHING,
        db_column="candidateId",
        db_constraint=False,
        related_name="pipeline_applications",
    )
    job = models.ForeignKey(
        Job,
        on_delete=models.DO_NOTHING,
        db_column="jobId",
        db_constraint=False,
        related_name="pipeline_applications",
    )
    stage = models.CharField(max_length=32)
    status = models.CharField(max_length=32)
    source = models.TextField(null=True, blank=True)
    cover_note = models.TextField(db_column="coverNote", null=True, blank=True)
    created_at = models.DateTimeField(db_column="createdAt")
    updated_at = models.DateTimeField(db_column="updatedAt")

    class Meta:
        managed = False
        db_table = "Application"
        default_permissions = ()
        ordering = ("-updated_at",)


class TimelineEvent(models.Model):
    """Prisma `"TimelineEvent"` — unmanaged. Used only for STAGE_CHANGED writes."""

    id = models.CharField(max_length=64, primary_key=True)
    application = models.ForeignKey(
        Application,
        on_delete=models.DO_NOTHING,
        db_column="applicationId",
        db_constraint=False,
        related_name="timeline_events",
    )
    type = models.CharField(max_length=64)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(db_column="createdAt")

    class Meta:
        managed = False
        db_table = "TimelineEvent"
        default_permissions = ()

