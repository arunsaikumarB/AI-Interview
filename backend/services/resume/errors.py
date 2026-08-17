"""Typed resume-processing failures. Never attach resume text to these exceptions."""


class ResumeError(Exception):
    error_class = "resume_error"
    retryable = False

    def __init__(self, error_class: str | None = None, message: str = "") -> None:
        self.error_class = error_class or self.error_class
        super().__init__(message or self.error_class)


class PermanentResumeError(ResumeError):
    retryable = False


class TransientResumeError(ResumeError):
    retryable = True
