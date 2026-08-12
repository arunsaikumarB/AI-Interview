export function CloudAiBanner() {
  return (
    <div
      role="status"
      className="sticky top-0 z-50 border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-950"
    >
      DEV MODE — AI running on Ollama Cloud. Candidate data leaves this machine.
      Not for production.
    </div>
  );
}
