import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSessionToken, setSessionCookie } from "@/lib/auth/session";
import { handleApiError, jsonCreated, jsonError } from "@/lib/api";

/** Public registration is candidate-only. Attaches to default org when present. */
const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(120),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const email = body.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return jsonError("Email already registered", 409);
    }

    const defaultOrg = await prisma.organization.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (!defaultOrg) {
      return jsonError("No organization configured. Ask an admin to seed the system.", 503);
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const [firstName, ...rest] = body.name.trim().split(/\s+/);
    const lastName = rest.join(" ") || "Candidate";

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: body.name,
        role: "CANDIDATE",
        organizationId: defaultOrg.id,
        candidate: {
          create: {
            organizationId: defaultOrg.id,
            email,
            firstName: firstName || body.name,
            lastName,
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        organizationId: true,
      },
    });

    const token = await createSessionToken(user);
    await setSessionCookie(token);

    return jsonCreated({ user });
  } catch (err) {
    return handleApiError(err);
  }
}
