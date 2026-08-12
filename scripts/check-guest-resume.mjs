import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const c = await p.candidate.findFirst({
  where: { email: { startsWith: "phase9-" } },
  orderBy: { createdAt: "desc" },
});
const rows = await p.$queryRawUnsafe(
  `SELECT ("embedding" IS NOT NULL) as "hasEmb" FROM "Candidate" WHERE id = $1`,
  c.id,
);
console.log({
  email: c.email,
  resumeUrl: Boolean(c.resumeUrl),
  resumeTextLen: c.resumeText?.length ?? 0,
  hasEmbedding: Boolean(rows[0]?.hasEmb),
});
await p.$disconnect();
