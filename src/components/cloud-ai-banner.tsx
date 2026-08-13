export function CloudAiBanner() {
  return (
    <div
      role="status"
      className="sticky top-0 z-50 border-b border-warning/30 bg-warning/15 px-4 py-2 text-center text-sm font-medium text-foreground"
    >
      DEV MODE — AI running on Ollama Cloud. Candidate data leaves this machine.
      Not for production.
    </div>
  );
}
