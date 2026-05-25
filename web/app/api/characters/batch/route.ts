/**
 * Batch character generation — DB-backed.
 *
 * POST creates a job row + queues row items, then kicks a fire-and-forget
 * runner. Returns the jobId immediately so the UI can navigate / refresh /
 * close the browser without losing progress.
 *
 * The UI polls /api/jobs/[id] for per-item status. After each row finishes
 * the runner also schedules an inline portrait lookup so cards render with
 * an avatar without an extra user click.
 */
import { NextRequest, NextResponse } from "next/server";
import { getClient, LLM_MODEL, llmReasoningExtras } from "@/lib/llm";
import {
  writeNewCharacter,
  updateCharacterPortrait,
  readIndex,
  type CharacterMeta,
} from "@/lib/repo";
import {
  createJob,
  startJob,
  finishJob,
  setItemStatus,
  runPool,
} from "@/lib/jobs";
import { resolveAvatar, downloadAvatarLocally } from "@/lib/avatar";
import { requireUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 1800;

interface IncomingRow {
  rowIndex: number;
  type: "real" | "fictional";
  id: string;
  name: string;
  era: string;
  tags: string[];
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    rows: IncomingRow[];
    concurrency?: number;
  };
  const rows = (body.rows || []).filter((r) => r.id && r.name);
  if (rows.length === 0) {
    return new NextResponse("no valid rows", { status: 400 });
  }
  const concurrency = Math.max(1, Math.min(10, body.concurrency ?? 5));
  const userId = await requireUserId();

  const jobId = await createJob({
    userId,
    kind: "batch-distill",
    title: `批量蒸馏 ${rows.length} 个角色`,
    concurrency,
    payload: { rowCount: rows.length },
    items: rows.map((r) => ({
      rowIndex: r.rowIndex,
      label: `${r.name} (${r.id})`,
      targetId: r.id,
    })),
  });

  // Fire-and-forget runner. Errors recorded in the job row.
  void runBatch(jobId, rows, concurrency);

  return NextResponse.json({ jobId, total: rows.length });
}

async function runBatch(
  jobId: string,
  rows: IncomingRow[],
  concurrency: number,
) {
  try {
    await startJob(jobId);
    const existing = new Set((await readIndex()).map((c) => c.id));

    await runPool(rows, concurrency, async (row) => {
      if (existing.has(row.id)) {
        await setItemStatus(jobId, row.rowIndex, "skipped", {
          message: "id 已存在",
        });
        return;
      }
      existing.add(row.id);
      try {
        await setItemStatus(jobId, row.rowIndex, "running");
        const skill = await distillRealSkill(row);

        const meta: CharacterMeta = {
          id: row.id,
          name: row.name,
          type: row.type,
          era: row.era || "",
          tags: row.tags || [],
          portrait: null,
          portrait_source: null,
          source_work: null,
          relations: [],
          skill_path: `characters/${row.type}/${row.id}/SKILL.md`,
        };
        await writeNewCharacter(meta, skill);
        await setItemStatus(jobId, row.rowIndex, "done");

        // Best-effort avatar fetch — failure doesn't bump the item to failed.
        try {
          const { url, source } = await resolveAvatar(row.name);
          if (url && source) {
            const local = await downloadAvatarLocally(url, row.id);
            await updateCharacterPortrait(
              row.id,
              local || url,
              local ? `${source}-local` : source,
            );
          }
        } catch (e) {
          console.warn(
            `[batch] avatar lookup failed for ${row.id}:`,
            (e as Error).message,
          );
        }
      } catch (e: any) {
        existing.delete(row.id);
        await setItemStatus(jobId, row.rowIndex, "failed", {
          message: e?.message?.slice(0, 480) || String(e),
        });
      }
    });

    await finishJob(jobId, "done");
  } catch (e: any) {
    await finishJob(jobId, "failed", undefined, e?.message || String(e));
  }
}

async function distillRealSkill(row: IncomingRow): Promise<string> {
  const client = getClient();
  const system = `你是 nuwa-skill（女娲）—— 一个把真实人物的思维框架蒸馏为可加载 SKILL.md 的工具。
基于你对该人物的已有知识，提炼出可被其他 Agent 加载并扮演的角色 SKILL.md。

输出必须严格按以下 Markdown 结构，**不要任何额外说明文字、不要 markdown 围栏**：

---
name: <id>
description: <一句话：何时调用这个角色 skill>
---

# <角色名> — 思维框架

## 表达 DNA
- 句式特征
- 高频词与禁忌词
- 节奏 / 语气
- 修辞偏好（≥ 3 条对比："像他会说的 X" vs "他绝不会说的 Y"）

## Mental Models（3-7 条）
每条："模型名 — 此人在面对 X 时如何看待，附一句他说过的原话或决策作为锚点"

## Decision Heuristics（5-10 条）
- "若 ... 则 ..." 句式，引用历史决策为出处

## 关系切换
- 与同类企业家：...
- 与质疑者：...
- 与下属 / 合作者：...

## Limitations（必须显式）
- 时代知识边界
- 性格 anti-patterns
- 当代议题盲区`;

  const user = [
    `请为真实人物【${row.name}】${row.era ? `（${row.era}）` : ""}蒸馏出可加载的 SKILL.md。`,
    `角色 id：${row.id}`,
    row.tags.length ? `标签：${row.tags.join("、")}` : "",
    "",
    "锚定该人物已公开的言论、决策、写作。严格输出 Markdown SKILL.md，不要 markdown 围栏外的文字。",
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await client.chat.completions.create({
    model: LLM_MODEL,
    ...llmReasoningExtras(4096),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const raw = resp.choices?.[0]?.message?.content ?? "";
  return raw.replace(/^```(?:markdown|md)?\s*/, "").replace(/\s*```\s*$/, "");
}
