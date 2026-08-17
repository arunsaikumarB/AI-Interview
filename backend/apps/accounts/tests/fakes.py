from apps.accounts.directory import IdentityRecord


class InactiveDirectory:
    def get(self, external_user_id: str) -> IdentityRecord | None:
        return IdentityRecord(
            id=external_user_id,
            email="inactive@example.com",
            is_active=False,
            organization_id="org_a",
            source_role="RECRUITER",
        )


class MissingUserDirectory:
    def get(self, external_user_id: str) -> IdentityRecord | None:
        return None
