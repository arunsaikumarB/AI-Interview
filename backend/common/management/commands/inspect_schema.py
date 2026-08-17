from django.core.management.base import BaseCommand
from django.db import connection
from django.db.utils import OperationalError


class Command(BaseCommand):
    help = (
        "Read-only: list public PostgreSQL tables. Does not create Django models "
        "or alter Prisma-managed tables."
    )

    def handle(self, *args, **options):
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT tablename
                    FROM pg_tables
                    WHERE schemaname = 'public'
                    ORDER BY tablename
                    """
                )
                tables = [row[0] for row in cursor.fetchall()]
        except OperationalError as exc:
            self.stderr.write(self.style.ERROR(f"PostgreSQL unreachable: {exc}"))
            self.stderr.write(
                "Start the existing HireOS stack (root docker compose) so port 55432 is up."
            )
            return

        self.stdout.write(f"public tables ({len(tables)}):")
        for name in tables:
            self.stdout.write(f"  {name}")
        prisma_markers = [
            t for t in tables if t in {"User", "Job", "Candidate", "_prisma_migrations"}
        ]
        if prisma_markers:
            self.stdout.write(
                self.style.SUCCESS(
                    "Prisma schema present. Django must not ALTER these tables in Phase 1."
                )
            )
