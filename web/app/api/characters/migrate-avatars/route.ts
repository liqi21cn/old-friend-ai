/**
 * One-shot migration: for every character whose `portrait` is a remote URL
 * (http*), fetch the bytes once and persist locally at /avatars/<id>.<ext>,
 * then rewrite the DB row to point at the local path.
 *
 * Skips characters whose portrait already starts with `/avatars/` (idempotent).
 */
import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db/client";
import { characters as charactersTable } from "@/lib/db/schema";
import {
  createJob,
  startJob,
  finishJob,
  setItemStatus,
  runPool,
} from "@/lib/jobs";
import { downloadAvatarLocally } from "@/lib/avatar";
import { updateCharacterPortrait } from "@/lib/repo";
import { requireUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(_req: NextRequest) {
  await ensureSchema();
  const userId = await requireUserId();

  const rows = await db()
    .select({
      id: charactersTable.id,
      name: charactersTable.name,
      portrait: charactersTable.portrait,
      portraitSource: charactersTable.portraitSource,
    })
    .from(charactersTable);

  const targets = rows.filter(
    (r) => r.portrait && /^https?:\/\//i.test(r.portrait),
  );
  if (targets.length === 0) {
    return NextResponse.json({
      jobId: null,
      total: 0,
      message: "所有头像已是本地路径，无需迁移",
    });
  }

  const jobId = await createJob({
    userId,
    kind: "avatar-migrate",
    title: `下载 ${targets.length} 个外链头像到本地`,
    concurrency: 3,
    items: targets.map((t, i) => ({
      rowIndex: i + 1,
      label: t.name,
      targetId: t.id,
    })),
  });

  void (async () => {
    try {
      await startJob(jobId);
      await runPool(targets, 3, async (target) => {
        const rowIndex = targets.indexOf(target) + 1;
        try {
          await setItemStatus(jobId, rowIndex, "running");
          const local = await downloadAvatarLocally(
            target.portrait!,
            target.id,
          );
          if (local) {
            const src = target.portraitSource
              ? target.portraitSource.endsWith("-local")
                ? target.portraitSource
                : `${target.portraitSource}-local`
              : "local";
            await updateCharacterPortrait(target.id, local, src);
            await setItemStatus(jobId, rowIndex, "done", { message: local });
          } else {
            await setItemStatus(jobId, rowIndex, "skipped", {
              message: "下载失败，保留原外链",
            });
          }
        } catch (e: any) {
          await setItemStatus(jobId, rowIndex, "failed", {
            message: e?.message?.slice(0, 240) || String(e),
          });
        }
      });
      await finishJob(jobId, "done");
    } catch (e: any) {
      await finishJob(jobId, "failed", undefined, e?.message || String(e));
    }
  })();

  return NextResponse.json({ jobId, total: targets.length });
}
