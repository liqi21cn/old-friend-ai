/**
 * Backfill avatars for all characters where portrait IS NULL.
 * Spawns a `avatar-refresh` job in the global queue.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq, isNull } from "drizzle-orm";
import { db, ensureSchema } from "@/lib/db/client";
import { characters as charactersTable } from "@/lib/db/schema";
import {
  createJob,
  startJob,
  finishJob,
  setItemStatus,
  runPool,
} from "@/lib/jobs";
import { resolveAvatar, downloadAvatarLocally } from "@/lib/avatar";
import { updateCharacterPortrait } from "@/lib/repo";
import { requireUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  await ensureSchema();
  const userId = await requireUserId();
  const url = new URL(req.url);
  const onlyMissing = url.searchParams.get("force") !== "1";

  const rows = await db()
    .select({
      id: charactersTable.id,
      name: charactersTable.name,
      portrait: charactersTable.portrait,
    })
    .from(charactersTable);

  const targets = onlyMissing ? rows.filter((r) => !r.portrait) : rows;
  if (targets.length === 0) {
    return NextResponse.json({ jobId: null, total: 0, message: "无需补头像" });
  }

  const jobId = await createJob({
    userId,
    kind: "avatar-refresh",
    title: `抓取 ${targets.length} 个角色的头像`,
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
          const { url, source } = await resolveAvatar(target.name);
          if (url && source) {
            const local = await downloadAvatarLocally(url, target.id);
            const finalUrl = local || url;
            const finalSource = local ? `${source}-local` : source;
            await updateCharacterPortrait(target.id, finalUrl, finalSource);
            await setItemStatus(jobId, rowIndex, "done", {
              message: finalSource,
            });
          } else {
            await setItemStatus(jobId, rowIndex, "skipped", {
              message: "未在维基/Wikidata/Bing 找到合适头像",
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
