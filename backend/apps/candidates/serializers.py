import re

from rest_framework import serializers

# Same as src/lib/resume/text.ts: the PDF reader's "-- 1 of 2 --" page lines are not resume content.
_PAGE_MARKER_LINE = re.compile(r"^[ \t]*--[ \t]*\d+[ \t]+of[ \t]+\d+[ \t]*--[ \t]*$", re.MULTILINE)


def public_resume_text(text):
    if text is None:
        return None
    cleaned = re.sub(r"\n{3,}", "\n\n", _PAGE_MARKER_LINE.sub("", text)).strip()
    return cleaned or None


class CandidateListSerializer(serializers.Serializer):
    """List row. Matches Next GET /api/candidates items: no phone, resume text, profile JSON, or internals."""

    id = serializers.CharField()
    email = serializers.CharField()
    firstName = serializers.CharField(source="first_name")
    lastName = serializers.CharField(source="last_name")
    location = serializers.CharField(allow_null=True)
    skills = serializers.ListField(child=serializers.CharField(), allow_null=True)
    experience = serializers.FloatField()
    createdAt = serializers.DateTimeField(source="created_at")
    updatedAt = serializers.DateTimeField(source="updated_at")
    applicationCount = serializers.IntegerField(source="application_count", required=False)
    hasResume = serializers.SerializerMethodField()

    def get_hasResume(self, obj):
        return bool(obj.resume_url)


class CandidateSerializer(serializers.Serializer):
    """Staff candidate detail payload. Omits embedding."""

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
    resumeText = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source="created_at")
    updatedAt = serializers.DateTimeField(source="updated_at")
    applicationCount = serializers.IntegerField(source="application_count", required=False)
    organization = serializers.SerializerMethodField()

    def get_resumeText(self, obj):
        return public_resume_text(obj.resume_text)

    def get_organization(self, obj):
        org = getattr(obj, "organization", None)
        if org is None:
            return None
        return {"id": org.id, "name": org.name, "slug": org.slug}
