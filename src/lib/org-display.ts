import { prisma } from "@/lib/db";
import { DEFAULT_COMPANY_NAME } from "@/lib/branding";

/** Recruiter-facing employer label from the org record. Never invent a second org. */
export async function resolveOrgLabel(organizationId?: string | null): Promise<string> {
  try {
    const org = organizationId
      ? await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true, companyName: true },
        })
      : await prisma.organization.findFirst({
          select: { name: true, companyName: true },
          orderBy: { createdAt: "asc" },
        });
    return org?.companyName?.trim() || org?.name || DEFAULT_COMPANY_NAME;
  } catch {
    return DEFAULT_COMPANY_NAME;
  }
}
