/**
 * Render a transcript into a Sequence-ID-keyed shot list — **fire-and-forget
 * job** model. POST creates a `render-storyboard` job and returns the jobId
 * immediately; the actual work happens in the background.
 *
 * Job layout:
 *   item rowIndex=0      → "Phase A · 镜头骨架"
 *   item rowIndex=1..N   → each Phase B per-shot segment generation
 *
 * Job total starts at 1, then jumps to 1+N after Phase A returns shotCount=N.
 *
 * Progress is pollable via GET /api/jobs/[jobId] and surfaces on the global
 * floating dock (which already polls /api/jobs/active).
 *
 * The final screenplay is persisted to MySQL + screenplays/<id>.{md,json}
 * when the job transitions to "done".
 */
import { NextRequest, NextResponse } from "next/server";
import { getClient, LLM_MODEL, llmReasoningExtras } from "@/lib/llm";
import { readTranscript, writeScreenplay } from "@/lib/repo";
import {
  SKELETON_SYSTEM,
  buildSkeletonUserPrompt,
  SEGMENTS_SYSTEM,
  buildSegmentsUserPrompt,
  renderSkeletonMarkdown,
} from "@/lib/video-prompts";
import { requireUserId } from "@/lib/auth";
import { withRetry } from "@/lib/retry";
import {
  createJob,
  startJob,
  finishJob,
  setItemStatus,
  addJobItems,
  updateJobTotal,
} from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 60; // we return jobId fast; background continues

const SEGMENT_CONCURRENCY = 4;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const userId = await requireUserId();
  const { episode = 1, sceneNo = 1 } = (await req.json().catch(() => ({}))) as {
    episode?: number;
    sceneNo?: number;
  };

  const transcript = await readTranscript(sessionId, userId);
  if (!transcript) {
    return new NextResponse("transcript not found", { status: 404 });
  }

  const ep = String(episode).padStart(2, "0");
  const sc = String(sceneNo).padStart(2, "0");
  const prefix = `EP${ep}_SC${sc}`;

  const jobId = await createJob({
    userId,
    kind: "render-storyboard",
    title: `渲染分镜 · ${sessionId}`,
    concurrency: SEGMENT_CONCURRENCY,
    // payload.sessionId lets the global progress dock build a "back to script"
    // link without hitting the DB again.
    payload: { sessionId, episode, sceneNo, prefix },
    items: [
      {
        rowIndex: 0,
        label: "Phase A · 镜头骨架",
        targetId: sessionId,
      },
    ],
  });

  // Fire-and-forget. Errors land on the job row.
  void runRender(
    jobId,
    userId,
    sessionId,
    transcript,
    prefix,
    episode,
    sceneNo,
  );

  return NextResponse.json({ jobId, sessionId });
}

async function runRender(
  jobId: string,
  userId: number,
  sessionId: string,
  transcript: any,
  prefix: string,
  episode: number,
  sceneNo: number,
) {
  try {
    await startJob(jobId);
    const client = getClient();

    // ===== Phase A · skeleton (auto-retry x3) =====
    await setItemStatus(jobId, 0, "running");
    let phaseAShots: unknown[];
    try {
      phaseAShots = await withRetry(
        async () => {
          const resp = await client.chat.completions.create({
            model: LLM_MODEL,
            ...llmReasoningExtras(16000),
            response_format: { type: "json_object" } as any,
            messages: [
              { role: "system", content: SKELETON_SYSTEM },
              {
                role: "user",
                content: buildSkeletonUserPrompt(prefix, transcript),
              },
            ],
          });
          const text = resp.choices?.[0]?.message?.content ?? "";
          const arr = extractSkeletonShots(text);
          if (!Array.isArray(arr) || arr.length === 0) {
            console.error(
              `[screenplay job ${jobId}] Phase A unparseable. raw[:800]=${text.slice(0, 800)}`,
            );
            throw new Error("model returned no parseable shots array");
          }
          return arr;
        },
        {
          attempts: 3,
          onRetry: async (attempt, err) => {
            console.warn(
              `[screenplay job ${jobId}] Phase A retry ${attempt}/3: ${err.message}`,
            );
            await setItemStatus(jobId, 0, "running", {
              message: `重试 ${attempt}/3`,
            });
          },
        },
      );
    } catch (e: any) {
      const msg = e?.message?.slice(0, 240) || String(e);
      await setItemStatus(jobId, 0, "failed", {
        message: `3 次重试均失败：${msg}`,
      });
      await finishJob(
        jobId,
        "failed",
        null,
        `Phase A 3 次重试失败 — 可在分镜横幅点「重试」或切换 OPENAI_MODEL`,
      );
      return;
    }

    const shots: any[] = phaseAShots.map((s: any, i: number) =>
      normalizeShot(s, prefix, i),
    );
    await setItemStatus(jobId, 0, "done", {
      message: `${shots.length} 个镜头`,
    });

    // Persist the bare skeleton immediately — users can already browse the
    // shot list while Phase B is enriching each shot with video_segments.
    try {
      const md = renderSkeletonMarkdown(prefix, shots, transcript);
      await writeScreenplay(sessionId, userId, shots, md, episode, sceneNo);
    } catch (e: any) {
      console.warn(
        `[screenplay job ${jobId}] skeleton writeScreenplay failed: ${e?.message}`,
      );
    }

    // ===== Insert Phase B items =====
    await addJobItems(
      jobId,
      shots.map((s, i) => ({
        rowIndex: i + 1,
        label: `${s.sequence_id} · ${s.shot_type || ""}`.trim(),
        targetId: s.sequence_id,
      })),
    );
    await updateJobTotal(jobId, 1 + shots.length);

    // ===== Phase B · segments per shot =====
    const sceneSummary = {
      setting: transcript.scene?.setting,
      conflict: transcript.scene?.conflict,
    };
    const characterDirectory = transcript.characters || [];

    let cursor = 0;
    await Promise.all(
      Array.from({ length: SEGMENT_CONCURRENCY }, async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= shots.length) return;
          const shot = shots[idx];
          const rowIndex = idx + 1;
          await setItemStatus(jobId, rowIndex, "running");
          try {
            const segments = await withRetry(
              async () => {
                const segResp = await client.chat.completions.create({
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
                const segText = segResp.choices?.[0]?.message?.content ?? "";
                const parsed = parseSegments(segText);
                if (!Array.isArray(parsed) || parsed.length === 0) {
                  console.error(
                    `[screenplay job ${jobId}] Phase B unparseable for ${shot.sequence_id}. raw[:800]=${segText.slice(0, 800)}`,
                  );
                  throw new Error("model returned no parseable segments");
                }
                return parsed;
              },
              {
                attempts: 3,
                onRetry: async (attempt, err) => {
                  console.warn(
                    `[screenplay job ${jobId}] Phase B retry ${attempt}/3 (${shot.sequence_id}): ${err.message}`,
                  );
                  await setItemStatus(jobId, rowIndex, "running", {
                    message: `重试 ${attempt}/3`,
                  });
                },
              },
            );
            shot.video_segments = segments;
            const w = validateSegments(shot);
            if (w.length) {
              shot._warnings = [...(shot._warnings || []), ...w];
            }
            await setItemStatus(jobId, rowIndex, "done", {
              message: `${segments.length} 段`,
            });
          } catch (e: any) {
            shot.video_segments = [];
            const msg = e?.message?.slice(0, 240) || String(e);
            shot._warnings = [
              ...(shot._warnings || []),
              `Phase B 3 次重试失败：${msg}`,
            ];
            await setItemStatus(jobId, rowIndex, "failed", {
              message: `3 次重试失败：${msg}`,
            });
          }
          // Persist after every shot (success or failure) so:
          //  - if Node crashes mid-batch, finished shots are saved
          //  - the storyboard table shows progress live, not all-or-nothing
          // JS is single-threaded so JSON.stringify(shots) atomically captures
          // whatever was mutated by other workers up to this point — safe.
          try {
            const md = renderSkeletonMarkdown(prefix, shots, transcript);
            await writeScreenplay(
              sessionId,
              userId,
              shots,
              md,
              episode,
              sceneNo,
            );
          } catch (writeErr: any) {
            console.warn(
              `[screenplay job ${jobId}] incremental writeScreenplay failed: ${writeErr?.message}`,
            );
          }
        }
      }),
    );

    // ===== Final persist (in case the last per-shot write raced) =====
    const markdown = renderSkeletonMarkdown(prefix, shots, transcript);
    await writeScreenplay(
      sessionId,
      userId,
      shots,
      markdown,
      episode,
      sceneNo,
    );

    await finishJob(jobId, "done", {
      sessionId,
      shotCount: shots.length,
      segmentCount: shots.reduce(
        (a, s) => a + (s.video_segments?.length || 0),
        0,
      ),
    });
  } catch (e: any) {
    await finishJob(jobId, "failed", null, e?.message || String(e));
  }
}

/* ===== Parsers (same as before, kept inline for atomic file) ===== */

function extractSkeletonShots(raw: string): unknown[] | null {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const pickArray = (v: any): unknown[] | null => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      for (const k of ["shots", "data", "result", "items", "storyboard"]) {
        if (Array.isArray(v[k])) return v[k];
      }
    }
    return null;
  };
  const direct = tryParse(raw.trim());
  if (direct) {
    const arr = pickArray(direct);
    if (arr) return arr;
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const v = tryParse(fenced[1].trim());
    if (v) {
      const arr = pickArray(v);
      if (arr) return arr;
    }
  }
  const arrayMatch = raw.match(/\[\s*\{[\s\S]*?\}\s*]/);
  if (arrayMatch) {
    const v = tryParse(arrayMatch[0]);
    if (Array.isArray(v)) return v;
  }
  const objMatch = raw.match(/\{[\s\S]*?"(?:shots|data|result|items|storyboard)"[\s\S]*\}/);
  if (objMatch) {
    const v = tryParse(objMatch[0]);
    if (v) {
      const arr = pickArray(v);
      if (arr) return arr;
    }
  }

  // Last-resort: model output was truncated mid-array (hit max_tokens). Find
  // the "shots" array opener, then walk top-level objects with a brace counter
  // until we hit one that ends cleanly. Anything past the last complete `}` is
  // dropped — at least the user gets the shots that did make it.
  const recovered = recoverPartialShots(raw);
  if (recovered && recovered.length > 0) return recovered;

  return null;
}

function recoverPartialShots(raw: string): unknown[] | null {
  // Locate "shots": [ ... and walk forward
  const m = raw.match(/"(?:shots|data|result|items|storyboard)"\s*:\s*\[/);
  if (!m) return null;
  let i = m.index! + m[0].length;
  const completed: unknown[] = [];

  while (i < raw.length) {
    // skip whitespace + commas
    while (i < raw.length && /[\s,]/.test(raw[i])) i++;
    if (i >= raw.length || raw[i] === "]") break;
    if (raw[i] !== "{") break;

    // walk one object, tracking braces + string escaping
    const start = i;
    let depth = 0;
    let inStr = false;
    let escape = false;
    let closed = false;
    while (i < raw.length) {
      const ch = raw[i];
      if (inStr) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            closed = true;
            i++;
            break;
          }
        }
      }
      i++;
    }
    if (!closed) break;
    const objStr = raw.slice(start, i);
    try {
      completed.push(JSON.parse(objStr));
    } catch {
      // skip a malformed mid-array object and try the next
    }
  }

  return completed.length > 0 ? completed : null;
}

function parseSegments(raw: string): unknown {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  // 1. JSON.parse the whole thing
  const direct = tryParse(raw.trim());
  if (Array.isArray(direct) && direct.length > 0) return direct;
  if (direct && typeof direct === "object") {
    // 1a. known array-valued keys
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
    // 1b. model wrapped a single segment as the top-level object
    if (typeof (direct as any).time_range === "string") {
      return [direct];
    }
    // 1c. dict-of-segments  { "0": {...}, "1": {...} }
    const values = Object.values(direct as any);
    if (
      values.length > 0 &&
      values.every((v) => v && typeof v === "object" && (v as any).time_range)
    ) {
      return values;
    }
  }

  // 2. raw [...] block (no fence)
  const arrMatch = raw.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (arrMatch) {
    const v = tryParse(arrMatch[0]);
    if (Array.isArray(v) && v.length > 0) return v;
  }

  // 3. truncated — walk objects manually inside whatever array we can find
  const recovered = recoverPartialSegments(raw);
  if (recovered && recovered.length > 0) return recovered;

  return null;
}

function recoverPartialSegments(raw: string): unknown[] | null {
  // Find either `[` at top level OR `"segments": [`
  const startMatch =
    raw.match(/"(?:segments|video_segments|data|items|result)"\s*:\s*\[/) ||
    raw.match(/\[\s*\{/);
  if (!startMatch) return null;
  let i = startMatch.index! + startMatch[0].length;
  if (raw[i - 1] === "{") i--;

  const completed: unknown[] = [];
  while (i < raw.length) {
    while (i < raw.length && /[\s,]/.test(raw[i])) i++;
    if (i >= raw.length || raw[i] === "]") break;
    if (raw[i] !== "{") break;

    const start = i;
    let depth = 0;
    let inStr = false;
    let escape = false;
    let closed = false;
    while (i < raw.length) {
      const ch = raw[i];
      if (inStr) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            closed = true;
            i++;
            break;
          }
        }
      }
      i++;
    }
    if (!closed) break;
    try {
      completed.push(JSON.parse(raw.slice(start, i)));
    } catch {
      // skip malformed mid-array object
    }
  }
  return completed.length > 0 ? completed : null;
}

function normalizeShot(shot: any, prefix: string, idx: number): any {
  const warnings: string[] = [];
  if (!shot.sequence_id) {
    shot.sequence_id = `${prefix}_SH${String(idx + 1).padStart(3, "0")}`;
  }
  if (typeof shot.duration_est !== "number") {
    shot.duration_est = 8;
    warnings.push("duration_est missing, defaulted to 8s");
  }
  if (shot.duration_est < 4 || shot.duration_est > 15) {
    warnings.push(
      `duration_est ${shot.duration_est}s outside 4-15 (model drifted)`,
    );
  }
  if (!Array.isArray(shot.dialogue)) shot.dialogue = [];
  if (!Array.isArray(shot.characters)) shot.characters = [];
  if (warnings.length) shot._warnings = warnings;
  return shot;
}

function validateSegments(shot: any): string[] {
  const w: string[] = [];
  if (!Array.isArray(shot.video_segments) || shot.video_segments.length === 0) {
    w.push("video_segments missing");
    return w;
  }
  let total = 0;
  for (const seg of shot.video_segments) {
    const m = (seg?.time_range || "").match(/^([\d.]+)-([\d.]+)s?$/);
    if (m) total += Number(m[2]) - Number(m[1]);
  }
  if (Math.abs(total - shot.duration_est) > 0.6) {
    w.push(
      `segments total ${total.toFixed(1)}s != duration_est ${shot.duration_est}s`,
    );
  }
  return w;
}
