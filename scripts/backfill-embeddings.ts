/**
 * Sequentially embed all candidates with NULL embedding.
 * Safe to re-run. Usage: npm run embed:backfill
 */
import { PrismaClient } from "@prisma/client";
import { embedCandidate } from "../src/lib/ai/embeddings";

const prisma = new PrismaClient();

async function main() {
  const missing = await prisma.$queryRaw<Array<{ id: string; email: string }>>`
    SELECT id, email FROM "Candidate" WHERE embedding IS NULL ORDER BY "createdAt" ASC
  `;

  console.log(`[embed:backfill] ${missing.length} candidate(s) with NULL embedding`);

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < missing.length; i++) {
    const row = missing[i];
    const n = i + 1;
    process.stdout.write(`[${n}/${missing.length}] ${row.email} … `);
    try {
      const result = await embedCandidate(row.id);
      if (result.skipped) {
        console.log(`skipped (${result.skipped})`);
        fail += 1;
      } else {
        console.log(`ok (${result.dims}d)`);
        ok += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAIL: ${msg}`);
      fail += 1;
    }
  }

  const remaining = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM "Candidate" WHERE embedding IS NULL
  `;
  console.log(
    `[embed:backfill] done — ok=${ok} fail/skip=${fail} still_null=${remaining[0]?.n ?? "?"}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
