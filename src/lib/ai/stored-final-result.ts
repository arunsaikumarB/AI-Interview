import { z } from "zod";
import { FinalDimensionsSchema, ResumeValidationItemSchema } from "@/lib/ai/interview";

/**
 * Read-side shape of a persisted INTERVIEW_OVERALL `scores` blob. New LLM output is
 * still validated with the strict FinalResultSchema before it is stored; rows that
 * carry only the overall score and dimensions must still render as completed.
 */
export const StoredFinalResultSchema = z.object({
  overall: z.number().min(0).max(100),
  dimensions: FinalDimensionsSchema,
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  resumeValidation: z.array(ResumeValidationItemSchema).default([]),
});

export type StoredFinalResult = z.infer<typeof StoredFinalResultSchema>;
