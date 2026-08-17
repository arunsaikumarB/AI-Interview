import { djangoGetAllPages, djangoGetJson } from "./django-client";
import type { DjangoApplication, DjangoCandidate, DjangoJob } from "./normalize";
import {
  normalizeApplicationListItem,
  normalizeCandidateListItem,
  normalizeJob,
} from "./normalize";

export async function djangoListJobs(
  request: Request,
  query?: { q?: string; status?: string },
) {
  const jobs = await djangoGetAllPages<DjangoJob>("/api/v1/jobs/", "jobs", {
    request,
    query: {
      q: query?.q,
      status: query?.status,
      ordering: "-created_at",
    },
  });
  return jobs.map(normalizeJob);
}

export async function djangoGetJob(request: Request, id: string) {
  const body = await djangoGetJson<{ job: DjangoJob }>(`/api/v1/jobs/${id}/`, {
    request,
  });
  return normalizeJob(body.job);
}

export async function djangoListCandidates(request: Request, q?: string) {
  const candidates = await djangoGetAllPages<DjangoCandidate>(
    "/api/v1/candidates/",
    "candidates",
    { request, query: { q, sort: "-updated_at" } },
  );
  return candidates.map(normalizeCandidateListItem);
}

export async function djangoListApplications(
  request: Request,
  query?: { q?: string; stage?: string; jobId?: string },
) {
  const applications = await djangoGetAllPages<DjangoApplication>(
    "/api/v1/applications/",
    "applications",
    {
      request,
      query: {
        q: query?.q,
        stage: query?.stage,
        jobId: query?.jobId,
        sort: "-updated_at",
      },
    },
  );
  return applications.map(normalizeApplicationListItem);
}

export async function djangoPipelineCounts(request: Request, jobId?: string) {
  return djangoGetJson<{
    counts: Record<string, number>;
    stages: string[];
  }>("/api/v1/applications/pipeline-counts/", {
    request,
    query: { jobId },
  });
}
