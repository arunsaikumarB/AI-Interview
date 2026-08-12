export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { logCloudProviderWarning } = await import("@/lib/ai/ollama");
  logCloudProviderWarning();
}
