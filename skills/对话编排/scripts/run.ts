/**
 * Multi-Agent parallel dialogue orchestrator.
 *
 * One round = one Promise.all over all characters, each issuing an independent
 * LLM call with that character's SKILL.md as system prompt. We deliberately
 * fan out in parallel within a round so no speaker has the prior turn's text
 * as an anchor — this preserves dramatic tension instead of collapsing to consensus.
 *
 * Provider-agnostic: uses the OpenAI SDK against any OpenAI-compatible endpoint.
 * Defaults target Tencent Cloud LKEAP DeepSeek; override via env:
 *   OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL.
 *
 * Shared by `scripts/run-dialogue.ts` (CLI) and (Phase 2) the Next.js API route.
 */
import OpenAI from "openai";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL || "https://tokenhub.tencentmaas.com/v1";
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "deepseek-v4-pro";

export interface CharacterRef {
  id: string;
  skillPath: string; // path relative to repoRoot
  name?: string;
}

export interface Scene {
  setting: string;
  conflict: string;
  goal: string;
  opener?: string;
}

export interface Turn {
  speaker: string;
  text: string;
  action?: string | null;
}

export interface Round {
  round: number;
  turns: Turn[];
}

export interface Transcript {
  sessionId: string;
  startedAt: string;
  scene: Scene;
  characters: CharacterRef[];
  rounds: Round[];
}

export interface RunOptions {
  characters: CharacterRef[];
  scene: Scene;
  rounds: number;
  repoRoot: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  onTurn?: (round: number, turn: Turn) => void;
}

const STOP_PATTERNS = [/落幕/, /对话结束/, /conflict_resolved/i];

export async function runDialogue(opts: RunOptions): Promise<Transcript> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const client = new OpenAI({
    apiKey,
    baseURL: opts.baseURL ?? DEFAULT_BASE_URL,
  });
  const model = opts.model ?? DEFAULT_MODEL;

  // Pre-load every character's SKILL.md once; reuse across rounds.
  const loaded = await Promise.all(
    opts.characters.map(async (c) => ({
      ...c,
      skill: await readFile(join(opts.repoRoot, c.skillPath), "utf8"),
    })),
  );

  const transcript: Transcript = {
    sessionId: randomUUID().slice(0, 8),
    startedAt: new Date().toISOString(),
    scene: opts.scene,
    characters: opts.characters,
    rounds: [],
  };

  for (let r = 1; r <= opts.rounds; r++) {
    const history = renderHistory(transcript);
    const allIds = opts.characters.map((x) => x.id);

    const turns = await Promise.all(
      loaded.map(async (c) => {
        const stage = stageBrief(opts.scene, allIds, c.id, r);
        const userPrompt = [
          history,
          "",
          stage,
          "",
          `严格输出 JSON：{"action": string | null, "text": string}。不要任何其他文字，不要 markdown 围栏。`,
        ].join("\n");

        const systemPrompt = [
          c.skill,
          "",
          "---",
          "你正在参与一场多 Agent 戏剧对话。每轮你只能发一段话和可选动作，严格遵守你自己的 SKILL 文档（包括 Limitations）。",
        ].join("\n");

        const resp = await client.chat.completions.create({
          model,
          max_tokens: 1024,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        });

        const raw = resp.choices?.[0]?.message?.content ?? "";
        const parsed = extractJson(raw);
        const turn: Turn = {
          speaker: c.id,
          text: typeof parsed.text === "string" ? parsed.text : raw.trim(),
          action: typeof parsed.action === "string" ? parsed.action : null,
        };
        opts.onTurn?.(r, turn);
        return turn;
      }),
    );

    transcript.rounds.push({ round: r, turns });

    if (turns.some((t) => STOP_PATTERNS.some((re) => re.test(t.text)))) break;
  }

  return transcript;
}

function renderHistory(t: Transcript): string {
  const head = [
    "【场景】 " + t.scene.setting,
    "【核心冲突】 " + t.scene.conflict,
    "【戏剧目标】 " + t.scene.goal,
  ];
  if (t.scene.opener) head.push("【开场】 " + t.scene.opener);

  if (t.rounds.length === 0) return head.join("\n");

  const body: string[] = [...head, "", "【已发生的对话】"];
  for (const round of t.rounds) {
    body.push(`-- 第 ${round.round} 轮 --`);
    for (const turn of round.turns) {
      const act = turn.action ? `（${turn.action}）` : "";
      body.push(`${turn.speaker}${act}: ${turn.text}`);
    }
  }
  return body.join("\n");
}

function stageBrief(scene: Scene, allIds: string[], myId: string, round: number): string {
  const others = allIds.filter((x) => x !== myId).join("、");
  return [
    "# 你的回合",
    `当前是第 ${round} 轮。`,
    `你的角色 id：${myId}`,
    `同台对手：${others}`,
    "",
    "规则：",
    "- 严格遵守你的 SKILL 文档中的『表达 DNA』、『Decision Heuristics』、『Limitations』。",
    "- 必须推动冲突或暴露立场，不可空泛附和。",
    "- 一段对白 + 可选的一个动作。动作必须能被镜头拍到。",
    "- 若你判断戏剧目标已达成，可在 text 末尾以 `落幕` 收尾。",
  ].join("\n");
}

function extractJson(raw: string): { text?: unknown; action?: unknown } {
  const tryParse = (s: string) => {
    try {
      const v = JSON.parse(s);
      return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(raw.trim());
  if (direct) return direct;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const v = tryParse(fenced[1].trim());
    if (v) return v;
  }

  const brace = raw.match(/\{[\s\S]*\}/);
  if (brace) {
    const v = tryParse(brace[0]);
    if (v) return v;
  }
  return {};
}

export async function saveTranscript(t: Transcript, outDir: string): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const p = join(outDir, `${t.sessionId}.json`);
  await writeFile(p, JSON.stringify(t, null, 2), "utf8");
  return p;
}
