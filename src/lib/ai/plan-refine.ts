import { z } from "zod";
import { AIError, chatJSON } from "@/lib/ai/ollama";
import {
  InterviewPlanSchema,
  type InterviewPlan,
} from "@/lib/ai/interview";

const PLAN_JSON_SCHEMA = `{
  "topics": [
    {
      "name": string,
      "why": string,
      "targetDifficulty": number (1-5),
      "fromResume": boolean
    }
  ] (5-8 items),
  "openingQuestion": {
    "question": string,
    "topic": string,
    "difficulty": number (1-5),
    "competency": string
  },
  "focusAreas": string[]
}`;

const RefineResultSchema = z.object({
  plan: InterviewPlanSchema,
  changeSummary: z.array(z.string()).min(1),
});

/**
 * Natural-language refine of an interview plan.
 * Returns validated plan + change summary, or throws AIError (caller keeps old plan).
 */
export async function refineInterviewPlan(params: {
  current: InterviewPlan;
  instruction: string;
}): Promise<{ plan: InterviewPlan; changeSummary: string[]; model: string }> {
  const system = `You revise an AI interview plan for a recruiter.

Apply ONLY the recruiter's instruction. Do not invent unrelated topics.
Keep 5-8 topics. Preserve structure. If the instruction is nonsense, unclear,
or cannot be applied, return the ORIGINAL plan unchanged and set changeSummary
to ["No changes — instruction could not be applied"].
Do not add design-tool topics (Figma, Photoshop, Sketch, Adobe XD) unless the
recruiter explicitly asks for them.

Return ONLY valid JSON matching this exact schema:
{
  "plan": ${PLAN_JSON_SCHEMA},
  "changeSummary": string[]  // short human bullets of what changed
}`;

  const user = `Current plan JSON:
${JSON.stringify(params.current, null, 2)}

Recruiter instruction:
${params.instruction.trim()}

Return the revised plan and changeSummary.`;

  const { data, model } = await chatJSON(system, user, RefineResultSchema, {
    temperature: 0.2,
  });

  return {
    plan: data.plan,
    changeSummary: data.changeSummary,
    model,
  };
}

/** Manual edit schema — recruiter may trim topics below AI min of 5. */
export const InterviewPlanEditSchema = z.object({
  topics: z
    .array(
      z.object({
        name: z.string().min(1),
        why: z.string().min(1),
        targetDifficulty: z.number().min(1).max(5),
        fromResume: z.boolean(),
      }),
    )
    .min(1)
    .max(12),
  openingQuestion: z.object({
    question: z.string().min(1),
    topic: z.string().min(1),
    difficulty: z.number().min(1).max(5),
    competency: z.string().min(1),
  }),
  focusAreas: z.array(z.string()),
});

export type InterviewPlanEdit = z.infer<typeof InterviewPlanEditSchema>;

export function summarizePlanDiff(
  before: InterviewPlan,
  after: InterviewPlanEdit,
): string[] {
  const changes: string[] = [];
  if (before.openingQuestion.question !== after.openingQuestion.question) {
    changes.push("Opening question text changed");
  }
  if (before.openingQuestion.topic !== after.openingQuestion.topic) {
    changes.push(
      `Opening topic: ${before.openingQuestion.topic} → ${after.openingQuestion.topic}`,
    );
  }
  if (before.openingQuestion.difficulty !== after.openingQuestion.difficulty) {
    changes.push(
      `Opening difficulty: ${before.openingQuestion.difficulty} → ${after.openingQuestion.difficulty}`,
    );
  }
  if (before.topics.length !== after.topics.length) {
    changes.push(
      `Topic count: ${before.topics.length} → ${after.topics.length}`,
    );
  }
  const beforeNames = before.topics.map((t) => t.name).join(" | ");
  const afterNames = after.topics.map((t) => t.name).join(" | ");
  if (beforeNames !== afterNames) {
    changes.push("Topic list / order updated");
  }
  const beforeFocus = before.focusAreas.join(" | ");
  const afterFocus = after.focusAreas.join(" | ");
  if (beforeFocus !== afterFocus) {
    changes.push("Focus areas updated");
  }
  return changes.length ? changes : ["Plan saved (no detectable field diffs)"];
}

export { AIError };
