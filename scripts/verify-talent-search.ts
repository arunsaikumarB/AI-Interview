/**
 * Smoke-verify talent hybrid search rankings (local Ollama + DB).
 * Usage: npx tsx scripts/verify-talent-search.ts
 */
import { PrismaClient } from "@prisma/client";
import { embed } from "../src/lib/ai/ollama";
import { parseTalentQuery } from "../src/lib/ai/talent-query";

const prisma = new PrismaClient();

async function search(query: string, filters?: {
  skillsLower?: string[];
  minInterviewScore?: number | null;
}) {
  const parsed = await parseTalentQuery(query);
  const f = parsed.query;
  const skillsLower = filters?.skillsLower ?? f.skills.map((s) => s.toLowerCase());
  const minInterview =
    filters?.minInterviewScore !== undefined
      ? filters.minInterviewScore
      : f.minInterviewScore;

  const vec = await embed(f.semanticText.slice(0, 6000));
  const lit = `[${vec.join(",")}]`;

  const rows = await prisma.$queryRawUnsafe<
    Array<{ firstName: string; lastName: string; similarity: number }>
  >(
    `
    SELECT c."firstName", c."lastName",
           round((1 - (c.embedding <=> $1::vector))::numeric, 4)::float AS similarity
    FROM "Candidate" c
    WHERE c.embedding IS NOT NULL
      AND (
        cardinality($2::text[]) = 0
        OR EXISTS (
          SELECT 1 FROM unnest(c.skills) AS s(skill)
          WHERE lower(s.skill) = ANY($2::text[])
        )
      )
      AND (
        $3::float IS NULL
        OR EXISTS (
          SELECT 1
          FROM "AIEvaluation" e
          INNER JOIN "Application" a ON a.id = e."applicationId"
          WHERE a."candidateId" = c.id
            AND e.kind = 'INTERVIEW_OVERALL'
            AND (e.scores->>'overall')::float >= $3
        )
      )
    ORDER BY c.embedding <=> $1::vector
    LIMIT 10
    `,
    lit,
    skillsLower,
    minInterview,
  );

  return { parsed: parsed.parsed, filters: f, rows };
}

async function main() {
  const q1 = await search("postgres docker platform engineer");
  console.log("\n1) postgres docker platform engineer");
  console.log("   parsed=", q1.parsed, "skills=", q1.filters.skills);
  q1.rows.forEach((r, i) =>
    console.log(`   ${i + 1}. ${r.firstName} ${r.lastName} sim=${r.similarity}`),
  );
  const blairRank = q1.rows.findIndex((r) => r.firstName === "Blair") + 1;
  console.log("   Blair rank:", blairRank || "absent", blairRank && blairRank <= 3 ? "OK" : "CHECK");

  const q2 = await search("designers with Figma");
  console.log("\n2) designers with Figma");
  console.log("   parsed=", q2.parsed, "skills=", q2.filters.skills);
  q2.rows.forEach((r, i) =>
    console.log(`   ${i + 1}. ${r.firstName} ${r.lastName} sim=${r.similarity}`),
  );
  const top2 = q2.rows.slice(0, 2).map((r) => r.firstName);
  const blairInTop = q2.rows.slice(0, 3).some((r) => r.firstName === "Blair");
  console.log(
    "   top:",
    top2.join(", "),
    "Blair low/absent:",
    !blairInTop ? "OK" : "CHECK",
  );

  const q3 = await search("engineers who scored above 80 in interviews");
  console.log("\n3) engineers who scored above 80 in interviews");
  console.log(
    "   parsed=",
    q3.parsed,
    "minInterview=",
    q3.filters.minInterviewScore,
  );
  q3.rows.forEach((r, i) =>
    console.log(`   ${i + 1}. ${r.firstName} ${r.lastName} sim=${r.similarity}`),
  );
  const onlyAlex =
    q3.rows.length === 1 && q3.rows[0].firstName === "Alex"
      ? "OK"
      : q3.rows.every((r) => r.firstName === "Alex")
        ? "OK (Alex only)"
        : "CHECK";
  console.log("   Alex-only filter:", onlyAlex);

  const q4 = await search("zzzzqwerty asdfgh nonsense blob");
  console.log("\n4) nonsense query");
  console.log("   parsed=", q4.parsed, "filters=", JSON.stringify(q4.filters));
  console.log("   results=", q4.rows.length, "(no 500)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
