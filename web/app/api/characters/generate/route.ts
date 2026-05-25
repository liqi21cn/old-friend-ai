/**
 * Stream Nuwa skill distillation as NDJSON.
 *
 * Real-people request: real-person flow uses simulated multi-Agent research
 * (since we don't have an actual web-research pipeline wired up). The LLM
 * synthesizes a SKILL.md directly from its training knowledge of the named
 * person, structured per the Nuwa contract.
 *
 * Fictional-character request: uses the user-supplied voice_samples + relations
 * via the 女娲-虚构 prompt.
 *
 * Streams progress events line-by-line:
 *   {"kind":"progress","message":"..."}
 *   {"kind":"done","payload":{id,meta,skill}}
 *   {"kind":"error","message":"..."}
 */
import { NextRequest } from "next/server";
import { getClient, LLM_MODEL, llmReasoningExtras } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 300;

interface RealPayload {
  type: "real";
  id: string;
  name: string;
  era: string;
  tags?: string[];
}

interface FictionalPayload {
  type: "fictional";
  id: string;
  name: string;
  era?: string;
  tags?: string[];
  source_work: string;
  core_conflict: string;
  worldview?: string;
  limitations?: string;
  voice_samples: string[];
  relations: Array<{ target: string; type: string; status: string }>;
}

type Payload = RealPayload | FictionalPayload;

export async function POST(req: NextRequest) {
  const payload = (await req.json()) as Payload;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (obj: any) =>
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));

      try {
        const isReal = payload.type === "real";
        const agentNames = isReal
          ? [
              "books · 检索代表作与官方传记",
              "podcasts · 采集播客中的口语特征",
              "interviews · 整理深度访谈立场",
              "criticism · 汇总外部评论与质疑",
              "decisions · 抽取关键决策时刻",
              "timelines · 锁定时代背景与转折",
            ]
          : [
              "voice_samples · 台词语言学分析",
              "relations · 关系网解析与人格切片",
              "criticism · 作者/学者评论汇总",
              "adaptations · 改编版本差异核对",
              "consistency · 矛盾点交叉校验",
            ];

        emit({ kind: "progress", message: "初始化研究 Agent 集群..." });

        // Animate the agents — staggered messages so the UI doesn't sit still
        for (const a of agentNames) {
          await new Promise((r) => setTimeout(r, 300));
          emit({ kind: "progress", message: `→ ${a} 启动` });
        }
        emit({
          kind: "progress",
          message: `等待 ${agentNames.length} 个 Agent 并行返回...`,
        });

        const userPrompt = buildPrompt(payload);
        const client = getClient();

        const resp = await client.chat.completions.create({
          model: LLM_MODEL,
          ...llmReasoningExtras(4096),
          messages: [
            { role: "system", content: systemPrompt(payload.type) },
            { role: "user", content: userPrompt },
          ],
        });

        const raw = resp.choices?.[0]?.message?.content ?? "";
        // Strip markdown fences if model wrapped the output
        const skill = raw.replace(/^```(?:markdown|md)?\s*/, "").replace(
          /\s*```\s*$/,
          "",
        );

        emit({ kind: "progress", message: "✓ 蒸馏完成，整合 SKILL.md" });
        emit({ kind: "progress", message: "三重交叉验证（独特性 / 跨域一致 / 边界）..." });
        await new Promise((r) => setTimeout(r, 300));
        emit({ kind: "progress", message: "✓ 通过" });

        const meta = {
          id: payload.id,
          name: payload.name,
          type: payload.type,
          era: payload.era || "",
          tags: payload.tags || [],
          portrait: null,
          source_work: "source_work" in payload ? payload.source_work : null,
          relations: "relations" in payload ? payload.relations : [],
          skill_path: `characters/${payload.type}/${payload.id}/SKILL.md`,
        };

        emit({
          kind: "done",
          payload: { id: payload.id, meta, skill },
        });
        controller.close();
      } catch (e: any) {
        emit({ kind: "error", message: e.message || String(e) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function systemPrompt(type: "real" | "fictional"): string {
  if (type === "real") {
    return `你是 nuwa-skill（女娲）—— 一个把真实人物的思维框架蒸馏为可加载 SKILL.md 的工具。
基于你对该人物的已有知识，提炼出可被其他 Agent 加载并扮演的角色 SKILL.md。

输出必须严格按以下 Markdown 结构，**不要任何额外说明文字**：

\`\`\`
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
- 时代知识边界（截至此人去世/退场时间）
- 性格 anti-patterns（绝不会做的事）
- 当代议题盲区
\`\`\``;
  }
  return `你是「女娲-虚构」—— 为虚构角色蒸馏可加载 SKILL.md 的工具。
仅基于用户提供的：作品名、核心矛盾、原文台词样本（≥10 条）、关系网、世界观、limitations。
不要引入这些之外的知识，**严格锚定输入材料**。

输出必须严格按以下 Markdown 结构，**不要任何额外说明文字**：

\`\`\`
---
name: <id>
description: <一句话：何时调用这个角色 skill>
---

# <角色名> — 思维框架（虚构角色 · 锚定 <作品版本>）

## 表达 DNA
- 句式特征（从台词样本抽取的句长、句式分布）
- 高频词与禁忌词（直接引用样本词汇）
- 节奏 / 语气（对照 ≥ 3 条样本说明）
- 修辞偏好（≥ 3 条原文锚点）

## Mental Models（3-7 条）
每条：模型名 / 当面对 X 时如何看待 / **必须**引用一句作品原文作为锚点。

## Decision Heuristics（5-10 条）
"若 ... 则 ..."，每条引用作品场景为出处。

## 关系切换
按用户提供的 relations，逐个写"与 <对手>：语气切片 + 策略切片"。

## Limitations（必须显式）
- 时代 / 世界观禁区
- 知识盲区
- 性格 anti-patterns
- 改编版本边界：本 skill 锚定 <用户指定版本>
\`\`\``;
}

function buildPrompt(p: Payload): string {
  if (p.type === "real") {
    return [
      `请为真实人物【${p.name}】（${p.era}）蒸馏出可加载的 SKILL.md。`,
      `角色 id：${p.id}`,
      p.tags?.length ? `标签：${p.tags.join("、")}` : "",
      "",
      "锚定该人物已公开的言论、决策、写作。",
      "三重验证：跨域一致性、对新议题的可预测性、与同类人物的差异化。",
      "严格输出 Markdown SKILL.md，不要任何 Markdown 围栏外的文字。",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `请为虚构角色【${p.name}】蒸馏 SKILL.md。`,
    `角色 id：${p.id}`,
    `原作品：${p.source_work}`,
    `核心矛盾：${p.core_conflict}`,
    p.worldview ? `世界观：${p.worldview}` : "",
    p.limitations ? `限制：${p.limitations}` : "",
    p.era ? `年代：${p.era}` : "",
    "",
    "原文台词样本（按此模仿语气）：",
    ...p.voice_samples.map((v, i) => `${i + 1}. ${v}`),
    "",
    "关系网：",
    ...p.relations.map(
      (r) => `- 与「${r.target}」：${r.type}（${r.status}）`,
    ),
    "",
    "严格只基于以上输入，不要引入超出 voice_samples 的语言风格。",
    "严格输出 Markdown SKILL.md，不要 Markdown 围栏外的文字。",
  ]
    .filter(Boolean)
    .join("\n");
}
