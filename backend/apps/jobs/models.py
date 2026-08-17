"""Read-only Prisma `"Job"` / `"Department"` mirrors. managed = False."""

from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.accounts.models import HireOSUser, Organization


class Department(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    organization_id = models.CharField(max_length=64, db_column="organizationId")
    name = models.CharField(max_length=512)
    created_at = models.DateTimeField(db_column="createdAt")
    updated_at = models.DateTimeField(db_column="updatedAt")

    class Meta:
        managed = False
        db_table = "Department"
        default_permissions = ()


class Job(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "DRAFT"
        OPEN = "OPEN", "OPEN"
        PAUSED = "PAUSED", "PAUSED"
        CLOSED = "CLOSED", "CLOSED"

    class EmploymentType(models.TextChoices):
        FULL_TIME = "FULL_TIME", "FULL_TIME"
        PART_TIME = "PART_TIME", "PART_TIME"
        CONTRACT = "CONTRACT", "CONTRACT"
        INTERN = "INTERN", "INTERN"
        TEMPORARY = "TEMPORARY", "TEMPORARY"

    id = models.CharField(max_length=64, primary_key=True)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.DO_NOTHING,
        db_column="organizationId",
        db_constraint=False,
        related_name="jobs",
    )
    department = models.ForeignKey(
        Department,
        on_delete=models.DO_NOTHING,
        db_column="departmentId",
        db_constraint=False,
        related_name="jobs",
        null=True,
        blank=True,
    )
    title = models.TextField()
    description = models.TextField()
    location = models.TextField(null=True, blank=True)
    experience_min = models.IntegerField(db_column="experienceMin")
    experience_max = models.IntegerField(db_column="experienceMax", null=True, blank=True)
    skills = ArrayField(models.TextField(), default=list, null=True, blank=True)
    salary_min = models.IntegerField(db_column="salaryMin", null=True, blank=True)
    salary_max = models.IntegerField(db_column="salaryMax", null=True, blank=True)
    employment_type = models.CharField(max_length=32, db_column="employmentType")
    openings = models.IntegerField()
    status = models.CharField(max_length=16)
    interview_stages = models.JSONField(db_column="interviewStages")
    screening_criteria = models.JSONField(db_column="screeningCriteria")
    created_by = models.ForeignKey(
        HireOSUser,
        on_delete=models.DO_NOTHING,
        db_column="createdById",
        db_constraint=False,
        related_name="created_jobs",
    )
    created_at = models.DateTimeField(db_column="createdAt")
    updated_at = models.DateTimeField(db_column="updatedAt")

    class Meta:
        managed = False
        db_table = "Job"
        default_permissions = ()
        ordering = ("-created_at",)


class JobApplicationRef(models.Model):
    """Count-only slice of Prisma `"Application"`. Not an Application domain model."""

    id = models.CharField(max_length=64, primary_key=True)
    job = models.ForeignKey(
        Job,
        on_delete=models.DO_NOTHING,
        db_column="jobId",
        db_constraint=False,
        related_name="application_refs",
    )

    class Meta:
        managed = False
        db_table = "Application"
        default_permissions = ()
