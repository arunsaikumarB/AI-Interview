import { jsonError } from "@/lib/api";
import { ResumeParserUnavailableError, type ResumeParserNotConfiguredError } from "@/lib/integrations/resume-parser";

/** User-facing message for a Resume Parser failure; details stay in the server log. */
export function resumeParserErrorResponse(err: ResumeParserNotConfiguredError | ResumeParserUnavailableError): Response {
  if (!(err instanceof ResumeParserUnavailableError)) {
    return jsonError("Resume Parser is not connected yet. Ask your administrator.", 503, { configured: false });
  }
  console.warn("[resume-parser] request failed", { reason: err.reason });
  switch (err.reason) {
    case "rejected_key":
      return jsonError("Resume Parser did not accept HireOS's access key. Ask your administrator.", 502);
    case "bad_request":
      return jsonError("Resume Parser could not run this search. Check the filters.", 400);
    case "too_large":
      return jsonError("The resume file from Resume Parser is larger than 10 MB.", 502);
    default:
      return jsonError("Resume Parser is not responding. Try again later.", 502);
  }
}
