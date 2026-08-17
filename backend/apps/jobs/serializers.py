from rest_framework import serializers


class JobSerializer(serializers.Serializer):
    id = serializers.CharField()
    organizationId = serializers.CharField(source="organization_id")
    departmentId = serializers.CharField(source="department_id", allow_null=True)
    title = serializers.CharField()
    description = serializers.CharField()
    location = serializers.CharField(allow_null=True)
    experienceMin = serializers.IntegerField(source="experience_min")
    experienceMax = serializers.IntegerField(source="experience_max", allow_null=True)
    skills = serializers.ListField(child=serializers.CharField(), allow_null=True)
    salaryMin = serializers.IntegerField(source="salary_min", allow_null=True)
    salaryMax = serializers.IntegerField(source="salary_max", allow_null=True)
    employmentType = serializers.CharField(source="employment_type")
    openings = serializers.IntegerField()
    status = serializers.CharField()
    interviewStages = serializers.JSONField(source="interview_stages")
    screeningCriteria = serializers.JSONField(source="screening_criteria")
    createdById = serializers.CharField(source="created_by_id")
    createdAt = serializers.DateTimeField(source="created_at")
    updatedAt = serializers.DateTimeField(source="updated_at")
    applicationCount = serializers.IntegerField(source="application_count", required=False)
    organization = serializers.SerializerMethodField()
    department = serializers.SerializerMethodField()
    createdBy = serializers.SerializerMethodField()

    def get_organization(self, obj):
        org = getattr(obj, "organization", None)
        if org is None:
            return None
        return {"id": org.id, "name": org.name, "slug": org.slug}

    def get_department(self, obj):
        dept = getattr(obj, "department", None)
        if dept is None:
            return None
        return {"id": dept.id, "name": dept.name}

    def get_createdBy(self, obj):
        user = getattr(obj, "created_by", None)
        if user is None:
            return None
        return {"id": user.id, "name": user.name, "email": user.email}
