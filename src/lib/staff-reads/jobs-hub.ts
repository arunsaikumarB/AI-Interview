import type { JobStatus, PipelineStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isInInterviewStage } from "@/lib/recruiting-ui";
import { djangoGetAllPages } from "./django-client";
import { useDjangoReads } from "./flag";
import type { DjangoApplication, DjangoJob } from "./normalize";
import { normalizeJob } from "./normalize";

export type JobsHubRow = {
  id: string;
  title: string;
  location: string | null;
  status: JobStatus;
  updatedAt: Date;
  applications: number;
  inInterview: number;
  selected: number;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export async function loadJobsHub(opts: {
  organizationId?: string;
  q: string;
  statusFilter?: JobStatus;
}): Promise<JobsHubRow[]> {
  if (useDjangoReads()) {
    return loadJobsHubFromDjango(opts);
  }
  return loadJobsHubFromPrisma(opts);
}

async function loadJobsHubFromPrisma(opts: {
  organizationId?: string;
  q: string;
  statusFilter?: JobStatus;
}): Promise<JobsHubRow[]> {
  const jobs = await prisma.job.findMany({
    where: {
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      ...(opts.statusFilter ? { status: opts.statusFilter } : {}),
      ...(opts.q
        ? {
            OR: [
              { title: { contains: opts.q, mode: "insensitive" as const } },
              { location: { contains: opts.q, mode: "insensitive" as const } },
              { department: { name: { contains: opts.q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      department: { select: { name: true } },
      applications: { select: { stage: true } },
    },
  });

  return jobs.map((job) => {
    const applications = job.applications.length;
    const inInterview = job.applications.filter((a) =>
      isInInterviewStage(a.stage),
    ).length;
    const selected = job.applications.filter((a) => a.stage === "SELECTED").length;
    return {
      id: job.id,
      title: job.title,
      location: job.location,
      status: job.status,
      updatedAt: job.updatedAt,
      applications,
      inInterview,
      selected,
    };
  });
}

async function loadJobsHubFromDjango(opts: {
  q: string;
  statusFilter?: JobStatus;
}): Promise<JobsHubRow[]> {
  const [rawJobs, rawApps] = await Promise.all([
    djangoGetAllPages<DjangoJob>("/api/v1/jobs/", "jobs", {
      query: {
        q: opts.q || undefined,
        status: opts.statusFilter,
        ordering: "-updated_at",
      },
    }),
    djangoGetAllPages<DjangoApplication>("/api/v1/applications/", "applications", {
      query: { sort: "-updated_at" },
    }),
  ]);

  const stats = new Map<string, { total: number; inInterview: number; selected: number }>();
  for (const app of rawApps) {
    const cur = stats.get(app.jobId) ?? { total: 0, inInterview: 0, selected: 0 };
    cur.total += 1;
    if (isInInterviewStage(app.stage as PipelineStage)) {
      cur.inInterview += 1;
    }
    if (app.stage === "SELECTED") cur.selected += 1;
    stats.set(app.jobId, cur);
  }

  return rawJobs.map((job) => {
    const n = normalizeJob(job);
    const s = stats.get(job.id) ?? { total: n._count.applications, inInterview: 0, selected: 0 };
    return {
      id: n.id,
      title: n.title,
      location: n.location,
      status: n.status as JobStatus,
      updatedAt: asDate(n.updatedAt),
      applications: s.total,
      inInterview: s.inInterview,
      selected: s.selected,
    };
  });
}
