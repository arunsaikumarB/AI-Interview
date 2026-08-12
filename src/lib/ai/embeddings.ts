import { prisma } from "@/lib/db";
import { embed } from "@/lib/ai/ollama";

const MAX_EMBED_CHARS = 6000;

/**
 * Build the text blob used for talent-pool embeddings.
 */
export function buildCandidateEmbedText(c: {
  summary: string | null;
  skills: string[];
  experience: number;
  resumeText: string | null;
}): string {
  const parts = [
    c.summary?.trim() ?? "",
    c.skills.length ? `Skills: ${c.skills.join(", ")}` : "",
    `Experience: ${c.experience} years`,
    c.resumeText?.trim() ?? "",
  ].filter(Boolean);
  return parts.join("\n\n").slice(0, MAX_EMBED_CHARS);
}

/**
 * Embed a candidate via local Ollama (nomic-embed-text, 768d) and write the
 * vector column with raw SQL. Idempotent — always recomputes from current profile.
 * Never uses cloud, regardless of AI_PROVIDER.
 */
export async function embedCandidate(
  candidateId: string,
): Promise<{ updated: boolean; dims: number; skipped?: string }> {
  const c = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      summary: true,
      skills: true,
      experience: true,
      resumeText: true,
    },
  });

  if (!c) {
    return { updated: false, dims: 0, skipped: "candidate_not_found" };
  }

  const text = buildCandidateEmbedText(c);
  if (!text.trim()) {
    return { updated: false, dims: 0, skipped: "empty_profile_text" };
  }

  const vector = await embed(text);
  if (vector.length !== 768) {
    console.warn(
      `[embeddings] expected 768 dims for candidate ${candidateId}, got ${vector.length}`,
    );
  }

  const literal = `[${vector.join(",")}]`;
  await prisma.$executeRawUnsafe(
    `UPDATE "Candidate" SET embedding = $1::vector, "updatedAt" = NOW() WHERE id = $2`,
    literal,
    candidateId,
  );

  return { updated: true, dims: vector.length };
}

/**
 * @deprecated Prefer embedCandidate(candidateId). Kept for screening call sites.
 */
export async function ensureCandidateEmbedding(params: {
  candidateId: string;
  text?: string;
  force?: boolean;
}): Promise<{ updated: boolean; dims: number }> {
  if (!params.force) {
    const rows = await prisma.$queryRaw<Array<{ has_embedding: boolean }>>`
      SELECT (embedding IS NOT NULL) AS has_embedding
      FROM "Candidate"
      WHERE id = ${params.candidateId}
    `;
    if (rows[0]?.has_embedding) {
      return { updated: false, dims: 0 };
    }
  }
  const result = await embedCandidate(params.candidateId);
  return { updated: result.updated, dims: result.dims };
}
