export function staffAsyncLabel(status: string | null): string {
  if (!status) return "";
  switch (status.toUpperCase()) {
    case "QUEUED":
      return "Queued";
    case "PROCESSING":
    case "RETRYING":
    case "ALREADY_PROCESSING":
      return "Processing";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}
