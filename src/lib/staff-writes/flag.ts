import { parseUseDjangoReads } from "@/lib/staff-reads/flag";

/** Phase 4C.1. Independent of READS and ASYNC. Default off. */
export function useDjangoStageWrites(): boolean {
  return parseUseDjangoReads(process.env.NEXT_PUBLIC_USE_DJANGO_STAGE_WRITES);
}

/** Phase 4C.2. Independent of READS, ASYNC, and STAGE_WRITES. Default off. */
export function useDjangoJobWrites(): boolean {
  return parseUseDjangoReads(process.env.NEXT_PUBLIC_USE_DJANGO_JOB_WRITES);
}

/** Phase 4C.3. Independent. Default off. */
export function useDjangoAdminWrites(): boolean {
  return parseUseDjangoReads(process.env.NEXT_PUBLIC_USE_DJANGO_ADMIN_WRITES);
}
