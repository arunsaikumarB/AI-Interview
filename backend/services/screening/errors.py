"""Screening-processing failures. Never attach resume, prompts, or reasoning."""


class ScreeningError(Exception):
    error_class = "screening_error"
    retryable = False

    def __init__(self, error_class: str | None = None, message: str = "") -> None:
        self.error_class = error_class or self.error_class
        super().__init__(message or self.error_class)


class PermanentScreeningError(ScreeningError):
    retryable = False


class TransientScreeningError(ScreeningError):
    retryable = True
