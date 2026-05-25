/**
 * Retry only the shots whose Phase B failed last time.
 *
 * Finds shots in the existing screenplay where video_segments is empty AND
 * _warnings contains a Phase B failure marker, then re-runs Phase B (with
 * the same 3-attempt withRetry policy) only for those. Successful shots are
 * left untouched.
 *
 * Returns the new jobId; progress is observable on the global dock and via
 * /api/jobs/[id] exactly like the full render job.
 */
import { NextRequest, NextResponse } from "next/server";
import { getClient, LLM_MODEL, llmReasoningExtras } from "@/lib/llm";
import { readScreenplay, readTranscript, writeScreenplay } from "@/lib/repo";
import {
  SEGMENTS_SYSTEM,
  buildSegmentsUserPrompt,
} from "@/lib/video-prompts";
import { requireUserId } from "@/lib/auth";
import { withRetry } from "@/lib/retry";
import {
  createJob,
  startJob,
  finishJob,
  setItemStatus,
} from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

const SEGMENT_CONCURRENCY = 4;

interface ShotLike {
  sequence_id: string;
  shot_type?: string;
  characters?: string[];
  action?: string | null;
  dialogue?: Array<{ speaker: string; text: string }>;
  beat?: string;
  camera_hint?: string;
  duration_est?: number;
  video_segments?: unknown[];
  _warnings?: string[];
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const userId = await requireUserId();

  const shotsRaw = (await readScreenplay(sessionId, userId)) as
    | ShotLike[]
    | null;
  const transcript = await readTranscript(sessionId, userId);
  if (!shotsRaw || !transcript) {
    return new NextResponse("screenplay not found", { status: 404 });
  }

  // Identify failed shots: empty video_segments OR a Phase B warning marker.
  const failed = shotsRaw
    .map((shot, idx) => ({ shot, idx }))
    .filter(
      ({ shot }) =>
        !Array.isArray(shot.video_segments) ||
        shot.video_segments.length === 0 ||
        (shot._warnings || []).some(
          (w) => w.includes("Phase B") || w.includes("video_segments missing"),
        ),
    );

  if (failed.length === 0) {
    return NextResponse.json({
      ok: true,
      jobId: null,
      message: "没有需要重试的镜头",
    });
  }

  const jobId = await createJob({
    userId,
    kind: "render-storyboard",
    title: `重试失败镜头 · ${sessionId} · ${failed.length} 个`,
    concurrency: SEGMENT_CONCURRENCY,
    payload: { sessionId, retryFailed: true },
    items: failed.map((f, i) => ({
      rowIndex: i + 1,
      label: `${f.shot.sequence_id} · ${f.shot.shot_type || ""}`.trim(),
      targetId: f.shot.sequence_id,
    })),
  });

  void runRetry(jobId, userId, sessionId, transcript, shotsRaw, failed);

  return NextResponse.json({ jobId, retryCount: failed.length });
}

async function runRetry(
  jobId: string,
  userId: number,
  sessionId: string,
  transcript: any,
  shots: ShotLike[],
  failed: Array<{ shot: ShotLike; idx: number }>,
) {
  try {
    await startJob(jobId);
    const client = getClient();
    const sceneSummary = {
      setting: transcript.scene?.setting,
      conflict: transcript.scene?.conflict,
    };
    const characterDirectory = transcript.characters || [];

    let cursor = 0;
    await Promise.all(
      Array.from({ length: SEGMENT_CONCURRENCY }, async () => {
        while (true) {
          const i = cursor++;
          if (i >= failed.length) return;
          const { shot, idx } = failed[i];
          const rowIndex = i + 1;
          await setItemStatus(jobId, rowIndex, "running");
          try {
            const segments = await withRetry(
              async () => {
                const resp = await client.chat.completions.create({
                  model: LLM_MODEL,
                  ...llmReasoningExtras(6000),
                  response_format: { type: "json_object" } as any,
                  messages: [
                    { role: "system", content: SEGMENTS_SYSTEM },
                    {
                      role: "user",
                      content: buildSegmentsUserPrompt(
                        shot,
                        sceneSummary,
                        characterDirectory,
                      ),
                    },
                  ],
                });
                const text = resp.choices?.[0]?.message?.content ?? "";
                const parsed = parseSegments(text);
                if (!Array.isArray(parsed) || parsed.length === 0) {
                  console.error(
                    `[retry-failed job ${jobId}] no segments for ${shot.sequence_id}. raw[:600]=${text.slice(0, 600)}`,
                  );
                  throw new Error("model returned no parseable segments");
                }
                return parsed;
              },
              {
                attempts: 3,
                onRetry: async (attempt, err) => {
                  console.warn(
                    `[retry-failed job ${jobId}] retry ${attempt}/3 (${shot.sequence_id}): ${err.message}`,
                  );
                  await setItemStatus(jobId, rowIndex, "running", {
                    message: `重试 ${attempt}/3`,
                  });
                },
              },
            );

            // Update the shot in-place; clear the failure warning(s)
            shots[idx].video_segments = segments;
            shots[idx]._warnings = (shots[idx]._warnings || []).filter(
              (w) =>
                !w.includes("Phase B") &&
                !w.includes("video_segments missing"),
            );
            if (shots[idx]._warnings && shots[idx]._warnings.length === 0) {
              delete shots[idx]._warnings;
            }
            await setItemStatus(jobId, rowIndex, "done", {
              message: `${segments.length} 段`,
            });
          } catch (e: any) {
            const msg = e?.message?.slice(0, 200) || String(e);
            await setItemStatus(jobId, rowIndex, "failed", {
              message: `3 次重试均失败：${msg}`,
            });
          }
        }
      }),
    );

    // Persist the modified shots back
    const existingMarkdown =
      (await readScreenplayMarkdown(sessionId, userId)) || "";
    await writeScreenplay(
      sessionId,
      userId,
      shots,
      existingMarkdown,
      1,
      1,
    );
    await finishJob(jobId, "done", { sessionId, retryCount: failed.length });
  } catch (e: any) {
    await finishJob(jobId, "failed", null, e?.message || String(e));
  }
}

async function readScreenplayMarkdown(
  sessionId: string,
  userId: number,
): Promise<string | null> {
  const { readScreenplayMarkdown: r } = await import("@/lib/repo");
  return r(sessionId, userId);
}

function parseSegments(raw: string): unknown {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw.trim());
  if (Array.isArray(direct) && direct.length > 0) return direct;
  if (direct && typeof direct === "object") {
    for (const key of [
      "segments",
      "video_segments",
      "data",
      "items",
      "result",
      "shots",
    ]) {
      const v = (direct as any)[key];
      if (Array.isArray(v) && v.length > 0) return v;
    }
    if (typeof (direct as any).time_range === "string") {
      return [direct];
    }
    const values = Object.values(direct as any);
    if (
      values.length > 0 &&
      values.every((v) => v && typeof v === "object" && (v as any).time_range)
    ) {
      return values;
    }
  }
  return null;
}
