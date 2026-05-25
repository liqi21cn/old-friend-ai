/**
 * Structured narrative analysis — extracts characters, scenes, items from a
 * session's transcript + storyboard in one LLM call.
 *
 * Prompt distilled from doc/分析提示词.docx · 任务一. The system has the
 * transcript (dialogue rounds + scene) and the rendered storyboard shots
 * (action lines) — we feed both as the "literary text" the doc expects.
 *
 * Output schema (loosely mirrors the doc; we keep our own minimal contract
 * so callers don't depend on every doc field):
 *
 * {
 *   "characters": [{ name, description, personalityTraits, states? }],
 *   "scenes":     [{ location, timeSetting, summary, atmosphere }],
 *   "items":      [{ name, type, description, significance, symbolism?, owner? }]
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { getClient, LLM_MODEL, llmReasoningExtras } from "@/lib/llm";
import { readScreenplay, readTranscript } from "@/lib/repo";
import { requireUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 180;

const SYSTEM = `你是一名专业的文学分析助手，专门从事小说、剧本和故事的结构化分析。你的任务是提取和分析文学作品中的角色、场景、物品和主题元素。这是一个合法的文学教育和创作辅助工具。请以专业、客观的方式进行分析，关注故事结构和叙事元素。

## 分析任务

对用户给出的文学文本进行深度分析，提取以下元素：

### 1. 角色分析
- 列出所有出场角色
- 【关键约束】每个人物只输出**一条**记录，绝对不要按"状态/年龄阶段/服装/情绪"拆分成多条。即使同一人物在剧中表现出多种状态，也只保留一条主条目；状态差异可以写进 description，不要写进 name 字段。
- name 字段只填本名（如「李明」），不要带括号注释、不要写成「李明（学生时期）」。
- 分析角色定位、性格特征、关系网络

### 2. 场景分析
- 列出剧情中出现的所有场景 / 地点
- 同一个地点的不同场景也需要列出，例如：酒店（大堂）、酒店（房间）、酒店（门口）
- 描述场景的时间设定和氛围

### 3. 物品分析
- 列出具有叙事意义或象征意义的重要物品
- 排除场景的常规陈设（如墙、桌椅、远山），除非镜头特意聚焦它
- 排除角色身体部位、衣饰细节
- 保留承载戏剧意义的物件：武器、信件、地图、官印、钥匙、酒杯、灯盏、卷轴、勋章、首饰等

## 输出格式（严格 JSON）

只输出一个 JSON 对象，不要 markdown 围栏、不要前言：

{
  "characters": [
    {
      "name": "角色名（可含状态）",
      "description": "角色外貌和背景描述，动力与目标（动机），约 200 字",
      "personalityTraits": ["性格特征1", "性格特征2"]
    }
  ],
  "scenes": [
    {
      "location": "场景名称（含子场景）",
      "timeSetting": "时间设定",
      "summary": "场景描述",
      "atmosphere": "氛围描述"
    }
  ],
  "items": [
    {
      "name": "物品名称",
      "type": "物品类型（如：武器、信物、卷轴、容器、首饰）",
      "description": "物品外观与材质描述",
      "significance": "叙事重要性",
      "symbolism": "象征意义",
      "owner": "持有者（可空字符串）"
    }
  ]
}

数量限制：
- characters 最多 12 个
- scenes 最多 8 个
- items 最多 10 个
- 按叙事重要性由高到低排序`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const userId = await requireUserId();

  const transcript = await readTranscript(sessionId, userId);
  const shotsRaw = await readScreenplay(sessionId, userId);
  if (!transcript) {
    return new NextResponse("session not found", { status: 404 });
  }
  const shots = (shotsRaw as any[]) || [];

  // Assemble the "literary text" the LLM will analyse.
  const sceneBlock = transcript.scene
    ? [
        "## 场景设定",
        `setting: ${transcript.scene.setting || "（未提供）"}`,
        transcript.scene.conflict
          ? `core_conflict: ${transcript.scene.conflict}`
          : "",
        transcript.scene.goal ? `goal: ${transcript.scene.goal}` : "",
        transcript.scene.opener
          ? `opener: ${transcript.scene.opener}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const dialogueBlock = (transcript.rounds || [])
    .map((r: any) => {
      const lines = r.turns.map((t: any) => {
        const act = t.action ? `（${t.action}）` : "";
        return `${t.speaker}${act}：${t.text}`;
      });
      return `### 第 ${r.round} 轮\n${lines.join("\n")}`;
    })
    .join("\n\n");

  const narrationBlock = transcript.narration
    ? `## 收束旁白\n${transcript.narration}`
    : "";

  const shotsBlock = shots.length
    ? [
        "## 分镜动作（用于丰富场景与物品识别）",
        ...shots.map((s: any) => {
          const dlg = (s.dialogue || [])
            .map((d: any) => `${d.speaker}：「${d.text}」`)
            .join(" ");
          return [
            `### ${s.sequence_id} · ${s.shot_type || ""} · ${s.beat || ""}`,
            s.action ? `（动作）${s.action}` : "",
            dlg,
          ]
            .filter(Boolean)
            .join("\n");
        }),
      ].join("\n")
    : "";

  const userPrompt = [
    "请对下面的文学文本进行结构化分析。",
    "",
    sceneBlock,
    "",
    "## 对话原文",
    dialogueBlock,
    "",
    narrationBlock,
    "",
    shotsBlock,
    "",
    "立即输出严格 JSON：`{ characters, scenes, items }`。",
  ]
    .filter(Boolean)
    .join("\n\n");

  const client = getClient();
  const resp = await client.chat.completions.create({
    model: LLM_MODEL,
    ...llmReasoningExtras(4000),
    response_format: { type: "json_object" } as any,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = resp.choices?.[0]?.message?.content ?? "";
  const parsed = parseAnalysis(raw);
  return NextResponse.json(parsed);
}

interface CharacterOut {
  name: string;
  description?: string;
  personalityTraits?: string[];
}
interface SceneOut {
  location: string;
  timeSetting?: string;
  summary?: string;
  atmosphere?: string;
}
interface ItemOut {
  name: string;
  type?: string;
  description?: string;
  significance?: string;
  symbolism?: string;
  owner?: string;
}

function parseAnalysis(raw: string): {
  characters: CharacterOut[];
  scenes: SceneOut[];
  items: ItemOut[];
} {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const obj =
    tryParse(raw.trim()) ||
    tryParse(raw.match(/\{[\s\S]*\}/)?.[0] || "") ||
    {};

  // Strip any parenthetical state suffix (e.g. "李明（学生时期）" → "李明") and
  // dedupe by base name — the LLM occasionally still emits state variants
  // despite the system prompt asking it not to.
  const stripState = (name: string) =>
    name.replace(/\s*[（(][^)）]*[）)]\s*$/u, "").trim();
  const seenChars = new Set<string>();
  const characters: CharacterOut[] = [];
  for (const c of obj?.characters || obj?.角色 || []) {
    if (!c || typeof c.name !== "string" || !c.name.trim()) continue;
    const base = stripState(c.name);
    if (!base || seenChars.has(base)) continue;
    seenChars.add(base);
    characters.push({
      name: base,
      description:
        typeof c.description === "string" ? c.description : undefined,
      personalityTraits: Array.isArray(c.personalityTraits)
        ? c.personalityTraits.filter((x: unknown) => typeof x === "string")
        : undefined,
    });
    if (characters.length >= 12) break;
  }

  const scenes: SceneOut[] = (obj?.scenes || obj?.场景 || [])
    .filter((s: any) => s && typeof s.location === "string" && s.location.trim())
    .slice(0, 8)
    .map((s: any) => ({
      location: s.location.trim(),
      timeSetting: typeof s.timeSetting === "string" ? s.timeSetting : undefined,
      summary: typeof s.summary === "string" ? s.summary : undefined,
      atmosphere: typeof s.atmosphere === "string" ? s.atmosphere : undefined,
    }));

  const items: ItemOut[] = (obj?.items || obj?.物品 || obj?.props || [])
    .filter((p: any) => p && typeof p.name === "string" && p.name.trim())
    .slice(0, 10)
    .map((p: any) => ({
      name: p.name.trim(),
      type: typeof p.type === "string" ? p.type : undefined,
      description: typeof p.description === "string" ? p.description : undefined,
      significance:
        typeof p.significance === "string" ? p.significance : undefined,
      symbolism: typeof p.symbolism === "string" ? p.symbolism : undefined,
      owner: typeof p.owner === "string" ? p.owner : undefined,
    }));

  return { characters, scenes, items };
}
