import { z } from "zod";
import {
  defaultQueueFile,
  enqueueProfileJobs,
  kickProfileWorker,
  profileJobStatus,
  recoverProfileJobs,
  type ProfileWorkerDeps,
} from "./profile-queue";

/** Wires the background resume reader to the real database, storage, OCR and local Ollama. */
async function productionDeps(): Promise<ProfileWorkerDeps> {
  const [{ prisma }, { chatJSON, AIError, foregroundChatBusy }, storage, parse, ocr, embeddings, ai] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/ai/ollama"),
    import("@/lib/storage"),
    import("@/lib/resume/parse"),
    import("./ocr"),
    import("@/lib/ai/embeddings"),
    import("./ai-profile"),
  ]);
  const jsonSchema = z.toJSONSchema(ai.AiProfileShape) as Record<string, unknown>;
  return {
    db: prisma,
    queueFile: await defaultQueueFile(),
    aiProfile: async (text) => {
      const { data } = await chatJSON(ai.AI_PROFILE_SYSTEM, ai.aiProfileUserPrompt(text), ai.AiProfileShape, {
        temperature: 0,
        numPredict: 1500,
        jsonSchema,
        background: true,
      });
      return ai.sanitizeAiProfile(data);
    },
    readResume: storage.readStoredFile,
    extractText: parse.extractResumeText,
    ocr: (buffer) => ocr.ocrPdfText(buffer),
    embed: embeddings.embedCandidate,
    isTransient: (err) => err instanceof AIError && (err.code === "OLLAMA_UNREACHABLE" || err.code === "OLLAMA_HTTP"),
    errorCode: (err) => (err instanceof AIError ? err.code : err instanceof Error ? err.name : "unknown"),
    isPreempted: (err) => err instanceof AIError && err.code === "PREEMPTED",
    foregroundBusy: () => foregroundChatBusy(),
    liveInterviews: () =>
      prisma.interviewSession.count({
        where: { status: "IN_PROGRESS", updatedAt: { gte: new Date(Date.now() - 30 * 60_000) } },
      }),
  };
}

export function startProfileWorker(): void {
  kickProfileWorker(productionDeps);
}

export async function queueProfileReading(
  jobs: Array<{ candidateId: string; organizationId: string; experienceSet: boolean }>,
): Promise<void> {
  await enqueueProfileJobs(await defaultQueueFile(), jobs);
  startProfileWorker();
}

export async function recoverAndStartProfileWorker(): Promise<void> {
  await recoverProfileJobs(await defaultQueueFile());
  startProfileWorker();
}

export async function profileReadingStatus(candidateId: string, organizationId: string) {
  return profileJobStatus(await defaultQueueFile(), candidateId, organizationId);
}
