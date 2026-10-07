import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { isDatabaseUnavailable } from "@/lib/api";
import { uploadRowSchema } from "@/lib/resume-upload/constants";
import {
  findCandidateId,
  lockCandidateEmail,
  saveUploadedResume,
  type ApplicationDetails,
  type UploadDeps,
} from "@/lib/resume-upload/upload";
import { firstPhone, linkedInUrl, resumeFileName } from "@/lib/integrations/resume-parser/add-profile";
import { CareersUnavailableError, type CareersApplication, type CareersClient } from "./client";
import { CAREERS_APPLICATION_SOURCE, CAREERS_SOURCE } from "./constants";
import { isSiteTime, laterSiteTime, oneLine, parseExperienceYears, parseSkills, plainText, splitName } from "./text";

/**
 * Brings applications from the LogiSoft careers site into HireOS. Each careers job becomes a
 * HireOS job (matched by its careers id, never duplicated); each application becomes an
 * Applied application on that job. An existing candidate (same email) is never changed: it only
 * gains the application. Nothing here moves a stage or makes a hiring decision. AI screening is
 * advisory and only queued for applications newer than `screenAfter`.
 */

const MAX_PAGES = 500;
const COVER_NOTE_MAX = 10_000;
const emailSchema = z.string().trim().toLowerCase().max(254).email();

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".txt": "text/plain",
};

export type CareersSyncReport = {
  mode: "full" | "incremental";
  /** Every page was read. Jobs are only closed after a complete full read. */
  complete: boolean;
  /** Why the run stopped early (a short code), or null. */
  error: string | null;
  seen: number;
  /** New candidates created (with or without a readable resume). */
  created: number;
  /** Existing candidates added to a job. */
  linked: number;
  alreadyImported: number;
  /** New candidates saved without a resume (missing or not an allowed file). */
  withoutResume: number;
  /** Rows without a usable email or with an unexpected shape. */
  invalid: number;
  failed: number;
  jobsCreated: number;
  jobsClosed: number;
  screeningQueued: number;
  /** Newest `applied_on` seen (site time). */
  latestAppliedOn: string | null;
};

export type CareersSyncDeps = {
  client: CareersClient;
  upload: UploadDeps;
  /** Queues advisory AI screening; false when the queue is full. */
  queueScreening?: (applicationId: string) => boolean;
};

export type CareersSyncOptions = {
  organizationId: string;
  /** Recorded as the creator of jobs made from the careers site. */
  actorId: string;
  mode: "full" | "incremental";
  /** Incremental runs: only applications after this site time. */
  after?: string | null;
  /** Screen applications applied after this site time; null = no screening (first import). */
  screenAfter: string | null;
};

function emptyReport(mode: CareersSyncReport["mode"]): CareersSyncReport {
  return {
    mode,
    complete: false,
    error: null,
    seen: 0,
    created: 0,
    linked: 0,
    alreadyImported: 0,
    withoutResume: 0,
    invalid: 0,
    failed: 0,
    jobsCreated: 0,
    jobsClosed: 0,
    screeningQueued: 0,
    latestAppliedOn: null,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
}

/** The form's answers as plain text, kept on the application (shown on the candidate page). */
export function applicationDetailsText(app: CareersApplication): string {
  const line = (label: string, value: string, max = 300) => {
    const v = oneLine(value, max);
    return v ? `${label}: ${v}` : null;
  };
  const when = isSiteTime(app.applied_on) ? ` on ${app.applied_on}` : "";
  const fields = [
    line("Total experience", app.total_experience),
    line("Relevant experience", app.relevant_experience),
    line("Skills", app.skills_exposure, 1_000),
    line("Education", app.education, 500),
    line("Current town", app.current_town),
    line("Hometown", app.hometown),
    line("Current CTC", app.current_ctc),
    line("Expected CTC", app.expected_ctc),
    line("Notice period", app.notice_period),
    line("Tentative joining", app.tentative_joining),
    line("Interview availability", app.interview_availability, 500),
    line("Reason for leaving", app.reason_leaving, 1_000),
    line("LinkedIn", app.linkedin_url, 500),
  ].filter((l): l is string => l !== null);
  const cover = plainText(app.cover_letter, 6_000);
  const parts = [`Applied on the LogiSoft careers page${when} (application ${app.application_id}).`];
  if (fields.length > 0) parts.push(fields.join("\n"));
  if (cover) parts.push(`Cover letter:\n${cover}`);
  return parts.join("\n\n").slice(0, COVER_NOTE_MAX);
}

function applicationDetails(app: CareersApplication): ApplicationDetails {
  return {
    source: CAREERS_APPLICATION_SOURCE,
    coverNote: applicationDetailsText(app),
    externalSource: CAREERS_SOURCE,
    externalId: String(app.application_id),
    payload: { careersApplicationId: app.application_id, careersJobId: app.job_id },
  };
}

export async function syncCareersApplications(
  db: PrismaClient,
  deps: CareersSyncDeps,
  opts: CareersSyncOptions,
): Promise<CareersSyncReport> {
  const { organizationId } = opts;
  const report = emptyReport(opts.mode);
  // The first import runs no AI at all: background profile reading only for later applicants.
  const upload: UploadDeps = opts.screenAfter === null ? { ...deps.upload, queueProfile: undefined } : deps.upload;
  const jobs = new Map<number, string>();
  const seenJobIds = new Set<string>();

  async function jobFor(app: CareersApplication): Promise<string> {
    const cached = jobs.get(app.job_id);
    if (cached) return cached;
    const externalId = String(app.job_id);
    const where = { organizationId_externalSource_externalId: { organizationId, externalSource: CAREERS_SOURCE, externalId } };
    let job = await db.job.findUnique({ where, select: { id: true } });
    if (!job) {
      const title = oneLine(app.job_title, 200) || `Careers job ${externalId}`;
      try {
        job = await db.job.create({
          data: {
            organizationId,
            title,
            description:
              "Imported from the LogiSoft careers page. Add the full job description and required skills here so " +
              "screening can compare applicants against them.",
            status: "OPEN",
            screeningCriteria: {},
            interviewStages: [],
            createdById: opts.actorId,
            externalSource: CAREERS_SOURCE,
            externalId,
          },
          select: { id: true },
        });
        report.jobsCreated++;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        job = await db.job.findUnique({ where, select: { id: true } });
        if (!job) throw err;
      }
    }
    jobs.set(app.job_id, job.id);
    return job.id;
  }

  async function maybeScreen(applicationId: string, app: CareersApplication): Promise<void> {
    if (!deps.queueScreening || opts.screenAfter === null) return;
    if (!isSiteTime(app.applied_on) || app.applied_on <= opts.screenAfter) return;
    const row = await db.application.findUnique({
      where: { id: applicationId },
      select: { candidate: { select: { resumeText: true } } },
    });
    if (!row?.candidate.resumeText) return;
    if (deps.queueScreening(applicationId)) report.screeningQueued++;
  }

  /** A new candidate with no usable resume file, or an existing one found at the last moment. */
  async function saveWithoutResume(
    app: CareersApplication,
    jobId: string,
    email: string,
  ): Promise<{ applicationId: string; created: boolean } | null> {
    const { firstName, lastName } = splitName(app.applicant_name, email);
    const details = applicationDetails(app);
    try {
      return await db.$transaction(async (tx) => {
        await lockCandidateEmail(tx, organizationId, email);
        let candidateId = await findCandidateId(tx, organizationId, email);
        const created = !candidateId;
        if (!candidateId) {
          const experience = parseExperienceYears(app.total_experience);
          const location = oneLine(app.current_town, 200);
          const linkedIn = linkedInUrl(oneLine(app.linkedin_url, 500));
          const skills = parseSkills(app.skills_exposure);
          const phone = firstPhone(app.applicant_phone);
          const candidate = await tx.candidate.create({
            data: {
              organizationId,
              email,
              firstName,
              lastName,
              phone: phone || null,
              ...(experience !== null ? { experience } : {}),
              ...(location ? { location } : {}),
              ...(linkedIn ? { linkedIn } : {}),
              ...(skills.length > 0 ? { skills } : {}),
            },
            select: { id: true },
          });
          candidateId = candidate.id;
        }
        const application = await tx.application.create({
          data: {
            jobId,
            candidateId,
            stage: "APPLIED",
            status: "ACTIVE",
            source: details.source,
            coverNote: details.coverNote,
            externalSource: details.externalSource,
            externalId: details.externalId,
            timelineEvents: {
              create: {
                type: "APPLICATION_CREATED",
                payload: { ...details.payload, source: details.source, ...(created ? { noResume: true } : { existingCandidate: true }) },
              },
            },
          },
          select: { id: true },
        });
        return { applicationId: application.id, created };
      });
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  async function linkExisting(app: CareersApplication, jobId: string, candidateId: string): Promise<void> {
    const current = await db.application.findUnique({
      where: { candidateId_jobId: { candidateId, jobId } },
      select: { id: true },
    });
    if (current) {
      // Same person already on this job (added by staff, or applied twice): remember the careers id only.
      await db.application.updateMany({
        where: { id: current.id, externalId: null },
        data: { externalSource: CAREERS_SOURCE, externalId: String(app.application_id) },
      });
      report.alreadyImported++;
      return;
    }
    const details = applicationDetails(app);
    try {
      const created = await db.application.create({
        data: {
          jobId,
          candidateId,
          stage: "APPLIED",
          status: "ACTIVE",
          source: details.source,
          coverNote: details.coverNote,
          externalSource: details.externalSource,
          externalId: details.externalId,
          timelineEvents: {
            create: {
              type: "APPLICATION_CREATED",
              payload: { ...details.payload, source: details.source, existingCandidate: true },
            },
          },
        },
        select: { id: true },
      });
      report.linked++;
      await maybeScreen(created.id, app);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      report.alreadyImported++;
    }
  }

  async function importOne(app: CareersApplication): Promise<void> {
    const jobId = await jobFor(app);
    const externalId = String(app.application_id);
    const done = await db.application.findFirst({
      where: { jobId, externalSource: CAREERS_SOURCE, externalId },
      select: { id: true },
    });
    if (done) {
      report.alreadyImported++;
      return;
    }

    const email = emailSchema.safeParse(oneLine(app.applicant_email, 320));
    if (!email.success) {
      report.invalid++;
      return;
    }
    const existingId = await findCandidateId(db, organizationId, email.data);
    if (existingId) {
      await linkExisting(app, jobId, existingId);
      return;
    }

    const file = await deps.client.getResume(app.application_id);
    if (file) {
      const fileName = resumeFileName(app.application_id, oneLine(app.resume_filename, 255) || file.fileName, file.mimeType);
      const mimeType = MIME_BY_EXT[extOf(fileName)] ?? file.mimeType;
      const { firstName, lastName } = splitName(app.applicant_name, email.data);
      const row = uploadRowSchema.parse({
        fileName,
        firstName,
        lastName,
        email: email.data,
        phone: firstPhone(app.applicant_phone),
        experience: parseExperienceYears(app.total_experience),
      });
      const result = await saveUploadedResume(db, {
        organizationId,
        jobId,
        row,
        type: mimeType,
        buffer: file.data,
        deps: upload,
        overrides: {
          location: oneLine(app.current_town, 200),
          linkedIn: linkedInUrl(oneLine(app.linkedin_url, 500)),
          skills: parseSkills(app.skills_exposure),
        },
        application: applicationDetails(app),
      });
      if (result.status === "created" || result.status === "linked") {
        if (result.status === "created") report.created++;
        else report.linked++;
        if (result.applicationId) await maybeScreen(result.applicationId, app);
        return;
      }
      if (result.status === "already_applied" || result.status === "exists") {
        report.alreadyImported++;
        return;
      }
      // Not an allowed resume file: keep the applicant, without the file.
    }

    const saved = await saveWithoutResume(app, jobId, email.data);
    if (!saved) {
      report.alreadyImported++;
      return;
    }
    if (saved.created) {
      report.created++;
      report.withoutResume++;
    } else {
      report.linked++;
    }
  }

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const result = await deps.client.listApplications({ page, after: opts.mode === "incremental" ? opts.after : null });
      report.invalid += result.malformed;
      for (const app of result.applications) {
        report.seen++;
        seenJobIds.add(String(app.job_id));
        if (isSiteTime(app.applied_on)) report.latestAppliedOn = laterSiteTime(report.latestAppliedOn, app.applied_on);
        try {
          await importOne(app);
        } catch (err) {
          if (err instanceof CareersUnavailableError || isDatabaseUnavailable(err)) throw err;
          report.failed++;
          console.error("[careers-sync] application failed", {
            applicationId: app.application_id,
            name: err instanceof Error ? err.name : typeof err,
            code: err instanceof Prisma.PrismaClientKnownRequestError ? err.code : undefined,
          });
        }
      }
      if (result.applications.length + result.malformed === 0 || page >= result.totalPages) {
        report.complete = true;
        break;
      }
    }
    if (!report.complete) report.error = "too_many_pages";
  } catch (err) {
    if (err instanceof CareersUnavailableError) report.error = err.reason;
    else if (isDatabaseUnavailable(err)) report.error = "database_unavailable";
    else throw err;
  }

  // Expired careers jobs drop out of the live list: close them (people and history stay).
  if (opts.mode === "full" && report.complete && report.seen > 0) {
    const closed = await db.job.updateMany({
      where: {
        organizationId,
        externalSource: CAREERS_SOURCE,
        status: "OPEN",
        externalId: { notIn: Array.from(seenJobIds) },
      },
      data: { status: "CLOSED" },
    });
    report.jobsClosed = closed.count;
  }
  return report;
}
