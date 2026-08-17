"""Post-session proctoring errors. Live ingest is not handled here."""


class ProctoringError(Exception):
    error_class = "proctoring_error"
    retryable = False

    def __init__(self, error_class: str | None = None, message: str = "") -> None:
        self.error_class = error_class or self.error_class
        super().__init__(message or self.error_class)


class PermanentProctoringError(ProctoringError):
    retryable = False


class TransientProctoringError(ProctoringError):
    retryable = True
