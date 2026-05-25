/**
 * Job machinery — fire-and-forget background runs persisted to MySQL so the
 * UI can poll status from any page after a refresh / cross-page navigation.
 *
 * The "in-flight" worker lives in the Node.js process; if you restart the dev
 * server while a job is running, its row stays in DB with status='running' but
 * no worker is alive. The recovery procedure is to manually mark the row
 * status='failed' or kick a new job. Phase 3 would add a watchdog.
 */
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, ensureSchema } from "./db/client";
import { jobs, jobItems, type NewJobRow, type NewJobItemRow } from "./db/schema";

export interface JobItemSpec {
  rowIndex: number;
  label: string;
  targetId?: string;
}

export async function createJob(input: {
  userId: number;
  kind: string;
  title: string;
  concurrency?: number;
  payload?: unknown;
  items: JobItemSpec[];
}): Promise<string> {
  await ensureSchema();
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  const row: NewJobRow = {
    id,
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    status: "pending",
    total: input.items.length,
    concurrency: input.concurrency ?? 1,
    payload: input.payload ?? null,
  };
  await db().insert(jobs).values(row);
  if (input.items.length > 0) {
    await db()
      .insert(jobItems)
      .values(
        input.items.map<NewJobItemRow>((it) => ({
          jobId: id,
          rowIndex: it.rowIndex,
          label: it.label,
          targetId: it.targetId ?? null,
          status: "queued",
        })),
      );
  }
  return id;
}

export async function startJob(jobId: string): Promise<void> {
  await db()
    .update(jobs)
    .set({ status: "running", startedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(jobs.id, jobId));
}

export async function finishJob(
  jobId: string,
  status: "done" | "failed" | "cancelled",
  result?: unknown,
  error?: string,
): Promise<void> {
  await db()
    .update(jobs)
    .set({
      status,
      result: result ?? null,
      error: error ?? null,
      finishedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(jobs.id, jobId));
}

/**
 * Bump the total count of a job — used when items are added after the job
 * was created (e.g. screenplay-render's Phase B shots count is only known
 * after Phase A completes).
 */
export async function updateJobTotal(
  jobId: string,
  total: number,
): Promise<void> {
  await db().update(jobs).set({ total }).where(eq(jobs.id, jobId));
}

/**
 * Append new items to an existing job. Same semantics as createJob's items
 * field but applied after the fact.
 */
export async function addJobItems(
  jobId: string,
  items: JobItemSpec[],
): Promise<void> {
  if (items.length === 0) return;
  await db()
    .insert(jobItems)
    .values(
      items.map((it) => ({
        jobId,
        rowIndex: it.rowIndex,
        label: it.label,
        targetId: it.targetId ?? null,
        status: "queued" as const,
      })),
    );
}

export async function setItemStatus(
  jobId: string,
  rowIndex: number,
  status: "queued" | "running" | "done" | "failed" | "skipped",
  patch: { message?: string; targetId?: string } = {},
): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (status === "running") updates.startedAt = sql`CURRENT_TIMESTAMP`;
  if (
    status === "done" ||
    status === "failed" ||
    status === "skipped"
  ) {
    updates.finishedAt = sql`CURRENT_TIMESTAMP`;
  }
  if (patch.message !== undefined) updates.message = patch.message.slice(0, 1000);
  if (patch.targetId !== undefined) updates.targetId = patch.targetId;
  await db()
    .update(jobItems)
    .set(updates)
    .where(and(eq(jobItems.jobId, jobId), eq(jobItems.rowIndex, rowIndex)));

  // Update counters on the parent job
  if (status === "done") {
    await db()
      .update(jobs)
      .set({ doneCount: sql`done_count + 1` })
      .where(eq(jobs.id, jobId));
  } else if (status === "failed") {
    await db()
      .update(jobs)
      .set({ failedCount: sql`failed_count + 1` })
      .where(eq(jobs.id, jobId));
  } else if (status === "skipped") {
    await db()
      .update(jobs)
      .set({ skippedCount: sql`skipped_count + 1` })
      .where(eq(jobs.id, jobId));
  }
}

/**
 * Fetch a single job + items, scoped to `userId`. Returns null if the job
 * doesn't exist OR belongs to someone else (we deliberately don't surface
 * the difference to the caller — same observable behaviour either way).
 */
export async function getJob(jobId: string, userId: number) {
  await ensureSchema();
  const rows = await db()
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  const items = await db()
    .select()
    .from(jobItems)
    .where(eq(jobItems.jobId, jobId))
    .orderBy(jobItems.rowIndex);
  return { ...rows[0], items };
}

export async function listJobs(
  userId: number,
  opts: { statuses?: string[]; limit?: number } = {},
) {
  await ensureSchema();
  const limit = opts.limit ?? 20;
  const filters = [eq(jobs.userId, userId)];
  if (opts.statuses?.length) {
    filters.push(inArray(jobs.status, opts.statuses as any));
  }
  return db()
    .select()
    .from(jobs)
    .where(and(...filters))
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
}

export async function listActiveJobs(userId: number) {
  return listJobs(userId, { statuses: ["pending", "running"], limit: 10 });
}

export async function cancelJob(jobId: string, userId: number) {
  await db()
    .update(jobs)
    .set({ status: "cancelled", finishedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.userId, userId),
        inArray(jobs.status, ["pending", "running"]),
      ),
    );
}

/**
 * Generic concurrency pool — feed up to `concurrency` workers from a shared cursor.
 * Each worker calls `runner(item)`; runner is responsible for updating item status.
 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  runner: (item: T, idx: number) => Promise<void>,
): Promise<void> {
  const n = Math.max(1, Math.min(10, concurrency));
  let cursor = 0;
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        await runner(items[idx], idx);
      } catch (e) {
        // runner is expected to capture its own failures via setItemStatus;
        // we swallow here so one worker exception doesn't kill the pool
        console.warn("[runPool] worker exception:", (e as Error).message);
      }
    }
  });
  await Promise.all(workers);
}
