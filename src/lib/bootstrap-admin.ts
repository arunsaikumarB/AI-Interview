import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

/**
 * One-time creation of the first Organization + SUPER_ADMIN on a fresh
 * production database. Operator-only: invoked by scripts/bootstrap-admin.ts
 * (`npm run bootstrap:admin`), never by an HTTP route, the build, or startup.
 */

/** Same cost as registration, admin user creation and the seed. */
export const BOOTSTRAP_BCRYPT_COST = 12;
export const PASSWORD_MIN_LENGTH = 12;
/** bcrypt ignores everything after 72 bytes; longer passwords are rejected rather than silently truncated. */
export const PASSWORD_MAX_BYTES = 72;

export type BootstrapErrorCode = "INVALID_INPUT" | "WEAK_PASSWORD" | "PASSWORD_MISMATCH" | "ALREADY_BOOTSTRAPPED";

export class BootstrapError extends Error {
  constructor(
    readonly code: BootstrapErrorCode,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "BootstrapError";
  }
}

export type BootstrapInput = {
  organizationName: string;
  adminName: string;
  adminEmail: string;
  password: string;
  passwordConfirmation: string;
};

export type ValidatedBootstrapInput = {
  organizationName: string;
  organizationSlug: string;
  adminName: string;
  adminEmail: string;
  password: string;
};

export type BootstrapState = { organizations: number; superAdmins: number; users: number };

export type BootstrapResult = {
  organization: { id: string; name: string; slug: string; createdAt: Date };
  admin: { id: string; name: string; email: string; role: "SUPER_ADMIN"; createdAt: Date };
};

/** Minimal surface so tests can pass an extended client. */
export type BootstrapDb = {
  $transaction<R>(fn: (tx: Prisma.TransactionClient) => Promise<R>, options?: { timeout?: number }): Promise<R>;
};

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const emailSchema = z.string().email().max(254);

export function organizationSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function passwordProblems(password: string, context: { adminEmail?: string } = {}): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`must be at least ${PASSWORD_MIN_LENGTH} characters`);
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) problems.push(`must be at most ${PASSWORD_MAX_BYTES} bytes`);
  if (!/[a-z]/.test(password)) problems.push("must contain a lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("must contain an uppercase letter");
  if (!/[0-9]/.test(password)) problems.push("must contain a digit");
  if (!/[^A-Za-z0-9]/.test(password)) problems.push("must contain a symbol");
  if (CONTROL_CHARS.test(password)) problems.push("must not contain control characters");
  const lower = password.toLowerCase();
  if (lower.includes("password")) problems.push('must not contain the word "password"');
  const local = context.adminEmail?.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 3 && lower.includes(local)) problems.push("must not contain the email name");
  return problems;
}

function cleanText(label: string, raw: string, min: number, max: number): string {
  const value = raw.trim();
  if (value.length < min || value.length > max) {
    throw new BootstrapError("INVALID_INPUT", `${label} must be ${min}-${max} characters.`);
  }
  if (CONTROL_CHARS.test(value)) throw new BootstrapError("INVALID_INPUT", `${label} must not contain control characters.`);
  return value;
}

export function validateBootstrapInput(input: BootstrapInput): ValidatedBootstrapInput {
  const organizationName = cleanText("Organization name", input.organizationName, 2, 120);
  const slug = organizationSlug(organizationName);
  if (slug.length < 2) {
    throw new BootstrapError("INVALID_INPUT", "Organization name must contain at least two letters or digits.");
  }
  const adminName = cleanText("Admin name", input.adminName, 2, 120);
  const adminEmail = input.adminEmail.trim().toLowerCase();
  if (!emailSchema.safeParse(adminEmail).success) {
    throw new BootstrapError("INVALID_INPUT", "Admin email is not a valid email address.");
  }
  const problems = passwordProblems(input.password, { adminEmail });
  if (problems.length) throw new BootstrapError("WEAK_PASSWORD", "Password does not meet the requirements.", problems);
  if (input.password !== input.passwordConfirmation) {
    throw new BootstrapError("PASSWORD_MISMATCH", "Password confirmation does not match.");
  }
  return { organizationName, organizationSlug: slug, adminName, adminEmail, password: input.password };
}

export async function readBootstrapState(db: Prisma.TransactionClient): Promise<BootstrapState> {
  const [organizations, superAdmins, users] = await Promise.all([
    db.organization.count(),
    db.user.count({ where: { role: "SUPER_ADMIN" } }),
    db.user.count(),
  ]);
  return { organizations, superAdmins, users };
}

export function alreadyBootstrappedReasons(state: BootstrapState): string[] {
  const reasons: string[] = [];
  if (state.organizations > 0) reasons.push(`${state.organizations} organization(s) already exist`);
  if (state.superAdmins > 0) reasons.push(`${state.superAdmins} SUPER_ADMIN account(s) already exist`);
  if (state.users > 0 && state.superAdmins === 0) reasons.push(`${state.users} user account(s) already exist`);
  return reasons;
}

export async function bootstrapAdmin(db: BootstrapDb, input: BootstrapInput): Promise<BootstrapResult> {
  const valid = validateBootstrapInput(input);
  const passwordHash = await bcrypt.hash(valid.password, BOOTSTRAP_BCRYPT_COST);

  return db.$transaction(
    async (tx) => {
      // Serialises concurrent bootstrap attempts; released automatically at commit/rollback.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('hireos:bootstrap-admin'))`;
      const reasons = alreadyBootstrappedReasons(await readBootstrapState(tx));
      if (reasons.length) {
        throw new BootstrapError("ALREADY_BOOTSTRAPPED", "This database is not fresh; bootstrap refused.", reasons);
      }
      const organization = await tx.organization.create({
        data: { name: valid.organizationName, slug: valid.organizationSlug, companyName: valid.organizationName },
        select: { id: true, name: true, slug: true, createdAt: true },
      });
      const admin = await tx.user.create({
        data: {
          email: valid.adminEmail,
          name: valid.adminName,
          role: "SUPER_ADMIN",
          passwordHash,
          organizationId: organization.id,
          isActive: true,
        },
        select: { id: true, name: true, email: true, createdAt: true },
      });
      return { organization, admin: { ...admin, role: "SUPER_ADMIN" as const } };
    },
    { timeout: 15_000 },
  );
}
