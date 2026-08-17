from rest_framework import serializers


class CandidateSerializer(serializers.Serializer):
    """Staff candidate payload. Omits embedding. Matches Next GET /api/candidates scalars."""

    id = serializers.CharField()
    organizationId = serializers.CharField(source="organization_id")
    userId = serializers.CharField(source="user_id", allow_null=True)
    email = serializers.CharField()
    firstName = serializers.CharField(source="first_name")
    lastName = serializers.CharField(source="last_name")
    phone = serializers.CharField(allow_null=True)
    linkedIn = serializers.CharField(source="linkedin", allow_null=True)
    location = serializers.CharField(allow_null=True)
    summary = serializers.CharField(allow_null=True)
    skills = serializers.ListField(child=serializers.CharField(), allow_null=True)
    experience = serializers.FloatField()
    education = serializers.JSONField()
    certifications = serializers.JSONField()
    resumeUrl = serializers.CharField(source="resume_url", allow_null=True)
    resumeText = serializers.CharField(source="resume_text", allow_null=True)
    createdAt = serializers.DateTimeField(source="created_at")
    updatedAt = serializers.DateTimeField(source="updated_at")
    applicationCount = serializers.IntegerField(source="application_count", required=False)
    organization = serializers.SerializerMethodField()

    def get_organization(self, obj):
        org = getattr(obj, "organization", None)
        if org is None:
            return None
        return {"id": org.id, "name": org.name, "slug": org.slug}
