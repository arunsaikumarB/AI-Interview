from rest_framework import serializers


class ApplicationSerializer(serializers.Serializer):
    id = serializers.CharField()
    candidateId = serializers.CharField(source="candidate_id")
    jobId = serializers.CharField(source="job_id")
    stage = serializers.CharField()
    status = serializers.CharField()
    source = serializers.CharField(allow_null=True)
    coverNote = serializers.CharField(source="cover_note", allow_null=True)
    createdAt = serializers.DateTimeField(source="created_at")
    updatedAt = serializers.DateTimeField(source="updated_at")
    candidate = serializers.SerializerMethodField()
    job = serializers.SerializerMethodField()

    def get_candidate(self, obj):
        c = obj.candidate
        return {
            "id": c.id,
            "firstName": c.first_name,
            "lastName": c.last_name,
            "email": c.email,
            "experience": c.experience,
            "skills": list(c.skills or []),
        }

    def get_job(self, obj):
        j = obj.job
        dept = getattr(j, "department", None)
        return {
            "id": j.id,
            "title": j.title,
            "status": j.status,
            "department": {"name": dept.name} if dept is not None else None,
        }
