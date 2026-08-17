"""Read-only Django mirrors of Prisma Organization / User.

managed = False — Django must never CREATE/ALTER these tables.
passwordHash is intentionally omitted so it cannot be selected via this model.
"""

from django.db import models


class Organization(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    name = models.CharField(max_length=512)
    slug = models.CharField(max_length=256)
    company_name = models.CharField(max_length=512, db_column="companyName", blank=True)
    created_at = models.DateTimeField(db_column="createdAt")
    updated_at = models.DateTimeField(db_column="updatedAt")

    class Meta:
        managed = False
        db_table = "Organization"
        default_permissions = ()


class HireOSUser(models.Model):
    """Prisma `"User"` row. Identity key is the existing cuid (`id`)."""

    id = models.CharField(max_length=64, primary_key=True)
    email = models.CharField(max_length=512)
    name = models.CharField(max_length=512)
    role = models.CharField(max_length=32)
    is_active = models.BooleanField(db_column="isActive")
    organization_id = models.CharField(
        max_length=64, db_column="organizationId", null=True, blank=True
    )
    department_id = models.CharField(
        max_length=64, db_column="departmentId", null=True, blank=True
    )
    created_at = models.DateTimeField(db_column="createdAt")
    updated_at = models.DateTimeField(db_column="updatedAt")

    class Meta:
        managed = False
        db_table = "User"
        default_permissions = ()
