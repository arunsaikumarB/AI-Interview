export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logCloudProviderWarning } = await import("@/lib/ai/ollama");
    logCloudProviderWarning();

    const { recoverAndStartProfileWorker } = await import("@/lib/resume-upload/profile-worker");
    void recoverAndStartProfileWorker().catch((err: unknown) => {
      console.error("[resume-profile] could not start", { name: err instanceof Error ? err.name : typeof err });
    });

    const { startCareersSyncSchedule } = await import("@/lib/integrations/careers/runner");
    void startCareersSyncSchedule().catch((err: unknown) => {
      console.error("[careers-sync] could not start", { name: err instanceof Error ? err.name : typeof err });
    });
  }
}
