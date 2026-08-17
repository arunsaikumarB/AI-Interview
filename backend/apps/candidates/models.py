"""Read-only Prisma `"Candidate"` mirror. managed = False. embedding is omitted on purpose."""

from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.accounts.models import Organization


class Candidate(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.DO_NOTHING,
        db_column="organizationId",
        db_constraint=False,
        related_name="candidates",
    )
    user_id = models.CharField(max_length=64, db_column="userId", null=True, blank=True)
    email = models.TextField()
    first_name = models.TextField(db_column="firstName")
    last_name = models.TextField(db_column="lastName")
    phone = models.TextField(null=True, blank=True)
    linkedin = models.TextField(db_column="linkedIn", null=True, blank=True)
    location = models.TextField(null=True, blank=True)
    summary = models.TextField(null=True, blank=True)
    skills = ArrayField(models.TextField(), default=list, null=True, blank=True)
    experience = models.FloatField()
    education = models.JSONField()
    certifications = models.JSONField()
    resume_url = models.TextField(db_column="resumeUrl", null=True, blank=True)
    resume_text = models.TextField(db_column="resumeText", null=True, blank=True)
    created_at = models.DateTimeField(db_column="createdAt")
    updated_at = models.DateTimeField(db_column="updatedAt")

    class Meta:
        managed = False
        db_table = "Candidate"
        default_permissions = ()
        ordering = ("-updated_at",)


class CandidateApplicationRef(models.Model):
    """Count-only slice of Prisma `"Application"`. Not an Application domain model."""

    id = models.CharField(max_length=64, primary_key=True)
    candidate = models.ForeignKey(
        Candidate,
        on_delete=models.DO_NOTHING,
        db_column="candidateId",
        db_constraint=False,
        related_name="application_refs",
    )

    class Meta:
        managed = False
        db_table = "Application"
        default_permissions = ()
