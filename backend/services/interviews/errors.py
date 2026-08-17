class InterviewError(Exception):
    error_class = "interview_error"
    retryable = False

    def __init__(self, error_class: str | None = None, message: str = "") -> None:
        self.error_class = error_class or self.error_class
        super().__init__(message or self.error_class)


class PermanentInterviewError(InterviewError):
    retryable = False


class TransientInterviewError(InterviewError):
    retryable = True
