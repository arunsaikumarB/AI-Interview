import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  canManagePipeline,
  orgScopeWhere,
  requireStaff,
} from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { embed, AIError } from "@/lib/ai/ollama";
import {
  parseTalentQuery,
  TalentQuerySchema,
  type TalentQuery,
} from "@/lib/ai/talent-query";

const bodySchema = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(50).default(20),
  /** When set, skip re-parse and search with these filters (chip edits). */
  filters: TalentQuerySchema.optional(),
  /** Extra org tag ids from UI filter (AND). */
  tagIds: z.array(z.string()).optional(),
});

type SearchRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  summary: string | null;
  skills: string[];
  experience: number;
  location: string | null;
  similarity: number | null;
  noEmbedding: boolean;
  screeningScore: number | null;
  interviewScore: number | null;
  tags: string[] | null;
};

function vectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/**
 * Hybrid talent search: embed semanticText + structured filters in one SQL.
 * Embeddings always local. Never touches Application.stage.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      return Response.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const body = bodySchema.parse(await request.json());
    const scope = orgScopeWhere(user);

    let appliedFilters: TalentQuery;
    let parsed: boolean;

    if (body.filters) {
      appliedFilters = body.filters;
      parsed = true;
    } else {
      const result = await parseTalentQuery(body.query);
      appliedFilters = result.query;
      parsed = result.parsed;
    }

    let queryVec: number[] | null = null;
    try {
      queryVec = await embed(appliedFilters.semanticText.slice(0, 6000));
    } catch (err) {
      if (!(err instanceof AIError)) throw err;
      console.warn("[talent/search] embed failed:", err.message);
      // Continue filter-only if structured filters exist
      const hasFilters =
        appliedFilters.skills.length > 0 ||
        appliedFilters.minExperience != null ||
        appliedFilters.maxExperience != null ||
        appliedFilters.minInterviewScore != null ||
        appliedFilters.minScreeningScore != null ||
        appliedFilters.location != null ||
        appliedFilters.tags.length > 0 ||
        (body.tagIds?.length ?? 0) > 0;
      if (!hasFilters) {
        return Response.json(
          {
            error: "Local embedding unavailable",
            detail: err.message,
            parsed,
            appliedFilters,
          },
          { status: 503 },
        );
      }
    }

    const orgId = scope.organizationId ?? null;
    const skillsLower = appliedFilters.skills.map((s) => s.toLowerCase());
    const tagNamesLower = appliedFilters.tags.map((t) => t.toLowerCase());
    const extraTagIds = body.tagIds ?? [];

    const rows = await runHybridSearch({
      orgId,
      vec: queryVec,
      limit: body.limit,
      skillsLower,
      minExperience: appliedFilters.minExperience,
      maxExperience: appliedFilters.maxExperience,
      minInterviewScore: appliedFilters.minInterviewScore,
      minScreeningScore: appliedFilters.minScreeningScore,
      location: appliedFilters.location,
      tagNamesLower,
      extraTagIds,
    });

    const totalCandidates = await prisma.candidate.count({
      where: orgId ? { organizationId: orgId } : undefined,
    });
    const withEmbeddingRows = orgId
      ? await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT COUNT(*)::bigint AS n FROM "Candidate"
          WHERE embedding IS NOT NULL AND "organizationId" = ${orgId}
        `
      : await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT COUNT(*)::bigint AS n FROM "Candidate" WHERE embedding IS NOT NULL
        `;

    return jsonOk({
      parsed,
      appliedFilters,
      query: body.query,
      results: rows.map((r) => ({
        id: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        summary: r.summary,
        skills: r.skills ?? [],
        experience: r.experience,
        location: r.location,
        similarity:
          r.similarity == null
            ? null
            : Math.round(Number(r.similarity) * 1000) / 1000,
        noEmbedding: Boolean(r.noEmbedding),
        screeningScore:
          r.screeningScore == null ? null : Number(r.screeningScore),
        interviewScore:
          r.interviewScore == null ? null : Number(r.interviewScore),
        tags: Array.isArray(r.tags) ? r.tags.filter(Boolean) : [],
      })),
      meta: {
        withEmbedding: Number(withEmbeddingRows[0]?.n ?? 0),
        totalCandidates,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

async function runHybridSearch(params: {
  orgId: string | null;
  vec: number[] | null;
  limit: number;
  skillsLower: string[];
  minExperience: number | null;
  maxExperience: number | null;
  minInterviewScore: number | null;
  minScreeningScore: number | null;
  location: string | null;
  tagNamesLower: string[];
  extraTagIds: string[];
}): Promise<SearchRow[]> {
  const vecLit = params.vec ? vectorLiteral(params.vec) : null;

  /*
   * Hybrid talent search SQL (embedded + NULL-embedding filter matches).
   *
   * Cosine similarity via pgvector: 1 - (embedding <=> query_vec)
   * Structured filters: skills overlap (case-insensitive), experience range,
   * location ILIKE, tag name / id, EXISTS latest AIEvaluation overall score.
   */
  const sql = `
WITH latest_screen AS (
  SELECT DISTINCT ON (a."candidateId")
    a."candidateId",
    (e.scores->>'overall')::float AS score
  FROM "AIEvaluation" e
  INNER JOIN "Application" a ON a.id = e."applicationId"
  WHERE e.kind = 'RESUME_SCREEN'
  ORDER BY a."candidateId", e."createdAt" DESC
),
latest_interview AS (
  SELECT DISTINCT ON (a."candidateId")
    a."candidateId",
    (e.scores->>'overall')::float AS score
  FROM "AIEvaluation" e
  INNER JOIN "Application" a ON a.id = e."applicationId"
  WHERE e.kind = 'INTERVIEW_OVERALL'
  ORDER BY a."candidateId", e."createdAt" DESC
),
cand_tags AS (
  SELECT ct."candidateId",
         array_agg(t.name ORDER BY t.name) AS tags
  FROM "CandidateTag" ct
  INNER JOIN "Tag" t ON t.id = ct."tagId"
  GROUP BY ct."candidateId"
),
filtered AS (
  SELECT
    c.id,
    c."firstName",
    c."lastName",
    c.email,
    c.summary,
    c.skills,
    c.experience,
    c.location,
    c.embedding,
    ls.score AS "screeningScore",
    li.score AS "interviewScore",
    COALESCE(ct.tags, ARRAY[]::text[]) AS tags
  FROM "Candidate" c
  LEFT JOIN latest_screen ls ON ls."candidateId" = c.id
  LEFT JOIN latest_interview li ON li."candidateId" = c.id
  LEFT JOIN cand_tags ct ON ct."candidateId" = c.id
  WHERE
    ($1::text IS NULL OR c."organizationId" = $1)
    AND (
      cardinality($2::text[]) = 0
      OR EXISTS (
        SELECT 1 FROM unnest(c.skills) AS s(skill)
        WHERE lower(s.skill) = ANY($2::text[])
      )
    )
    AND ($3::float IS NULL OR c.experience >= $3)
    AND ($4::float IS NULL OR c.experience <= $4)
    AND ($5::text IS NULL OR c.location ILIKE '%' || $5 || '%')
    AND (
      $6::float IS NULL
      OR EXISTS (
        SELECT 1 FROM latest_interview x
        WHERE x."candidateId" = c.id AND x.score >= $6
      )
    )
    AND (
      $7::float IS NULL
      OR EXISTS (
        SELECT 1 FROM latest_screen x
        WHERE x."candidateId" = c.id AND x.score >= $7
      )
    )
    AND (
      cardinality($8::text[]) = 0
      OR EXISTS (
        SELECT 1 FROM "CandidateTag" ct2
        INNER JOIN "Tag" t2 ON t2.id = ct2."tagId"
        WHERE ct2."candidateId" = c.id
          AND lower(t2.name) = ANY($8::text[])
      )
    )
    AND (
      cardinality($9::text[]) = 0
      OR EXISTS (
        SELECT 1 FROM "CandidateTag" ct3
        WHERE ct3."candidateId" = c.id
          AND ct3."tagId" = ANY($9::text[])
      )
    )
)
SELECT
  id,
  "firstName",
  "lastName",
  email,
  summary,
  skills,
  experience,
  location,
  CASE WHEN $10::vector IS NULL THEN NULL
       ELSE round((1 - (embedding <=> $10::vector))::numeric, 4)::float
  END AS similarity,
  false AS "noEmbedding",
  "screeningScore",
  "interviewScore",
  tags
FROM filtered
WHERE embedding IS NOT NULL
UNION ALL
SELECT
  id,
  "firstName",
  "lastName",
  email,
  summary,
  skills,
  experience,
  location,
  NULL::float AS similarity,
  true AS "noEmbedding",
  "screeningScore",
  "interviewScore",
  tags
FROM filtered
WHERE embedding IS NULL
  AND (
    cardinality($2::text[]) > 0
    OR $3::float IS NOT NULL
    OR $4::float IS NOT NULL
    OR $5::text IS NOT NULL
    OR $6::float IS NOT NULL
    OR $7::float IS NOT NULL
    OR cardinality($8::text[]) > 0
    OR cardinality($9::text[]) > 0
  )
ORDER BY "noEmbedding" ASC, similarity DESC NULLS LAST
LIMIT $11
`;

  const rows = await prisma.$queryRawUnsafe<SearchRow[]>(
    sql,
    params.orgId,
    params.skillsLower,
    params.minExperience,
    params.maxExperience,
    params.location,
    params.minInterviewScore,
    params.minScreeningScore,
    params.tagNamesLower,
    params.extraTagIds,
    vecLit,
    params.limit,
  );

  return rows;
}
