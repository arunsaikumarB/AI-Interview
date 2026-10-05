import type { Role } from "@prisma/client";
import { z } from "zod";

/** Client-safe: no server imports. */

export const RESUME_UPLOAD_SOURCE = "resume_upload";
export const UPLOAD_ROLES: Role[] = ["SUPER_ADMIN", "HR_ADMIN", "RECRUITER"];

export const UPLOAD_SELECTION_MAX_FILES = 300;
export const UPLOAD_BATCH_MAX_FILES = 20;
export const UPLOAD_BATCH_MAX_BYTES = 40 * 1024 * 1024;

export const uploadRowSchema = z.object({
  fileName: z.string().min(1).max(255),
  firstName: z.string().trim().min(1, "first name is required").max(100, "first name is too long"),
  lastName: z.string().trim().max(100, "last name is too long"),
  email: z.string().trim().toLowerCase().max(254, "email is too long").email("email is not valid"),
  phone: z.string().trim().max(30, "phone is too long").regex(/^[+\d\s().-]*$/, "phone is not valid"),
  experience: z.number().min(0, "experience must be 0–50").max(50, "experience must be 0–50").nullable(),
});

export type UploadRow = z.infer<typeof uploadRowSchema>;

/**
 * Some PDFs drop the last character of each line from their text layer
 * ("gmail.co", a 9-digit mobile). These are hints for HR, not blockers.
 */
export function rowWarnings(fields: { email: string; phone: string }): string[] {
  const warnings: string[] = [];
  if (/@(?:gmail|yahoo|outlook|hotmail|rediffmail|icloud|live)\.(?:c|co|cm|om)$/i.test(fields.email.trim())) {
    warnings.push("email looks cut off");
  }
  const digits = fields.phone.replace(/\D/g, "");
  if (digits && (digits.length < 10 || (digits.length === 11 && digits.startsWith("91")))) {
    warnings.push("phone looks incomplete");
  }
  return warnings;
}
