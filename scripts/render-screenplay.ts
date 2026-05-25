/**
 * Render a dialogue transcript into a short-drama storyboard.
 *
 *   pnpm tsx scripts/render-screenplay.ts \
 *     --session <sessionId> \
 *     [--episode 1] [--scene-no 1] [--out screenplays]
 *
 * Outputs:
 *   screenplays/<sessionId>.md   — human-readable storyboard
 *   screenplays/<sessionId>.json — Sequence-ID-keyed shot array for downstream import
 *
 * Provider-agnostic via OpenAI SDK; defaults to Tencent Cloud LKEAP DeepSeek.
 */
import OpenAI from "openai";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const BASE_URL = process.env.OPENAI_BASE_URL || "https://tokenhub.tencentmaas.com/v1";
const MODEL = process.env.OPENAI_MODEL || "deepseek-v4-pro";

interface Args {
  session: string;
  episode: number;
  sceneNo: number;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Partial<Args> = { episode: 1, sceneNo: 1 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--session") a.session = argv[++i];
    else if (k === "--episode") a.episode = Number(argv[++i]);
    else if (k === "--scene-no") a.sceneNo = Number(argv[++i]);
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--help" || k === "-h") usage(0);
    else {
      console.error(`unknown arg: ${k}`);
      usage(2);
    }
  }
  if (!a.session) usage(2);
  if (!Number.isInteger(a.episode!) || a.episode! < 1 || a.episode! > 99) {
    console.error(`--episode must be 1..99`);
    usage(2);
  }
  if (!Number.isInteger(a.sceneNo!) || a.sceneNo! < 1 || a.sceneNo! > 99) {
    console.error(`--scene-no must be 1..99`);
    usage(2);
  }
  return a as Args;
}

function usage(code: number): never {
  console.error(
    [
      "usage: tsx scripts/render-screenplay.ts \\",
      "         --session <sessionId> \\",
      "         [--episode <1..99>] \\",
      "         [--scene-no <1..99>] \\",
      "         [--out <dir>]",
    ].join("\n"),
  );
  process.exit(code);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY not set");
    process.exit(2);
  }

  const transcriptPath = join(REPO_ROOT, `transcripts/${args.session}.json`);
  const transcript = JSON.parse(await readFile(transcriptPath, "utf8"));
  const spec = await readFile(
    join(REPO_ROOT, "skills/短剧生成/references/storyboard-spec.md"),
    "utf8",
  );

  const ep = String(args.episode).padStart(2, "0");
  const sc = String(args.sceneNo).padStart(2, "0");
  const idPrefix = `EP${ep}_SC${sc}`;

  const userPrompt = [
    `请将以下对话渲染为短剧分镜脚本。本场次 Sequence ID 前缀：${idPrefix}_SH###`,
    "",
    "## 输出要求",
    "1. 先输出 Markdown 分镜稿（场景头 + 逐镜）。",
    "2. 紧接着一段 ```json ... ``` fenced 代码块，内容为镜头数组。",
    "3. JSON 块的键名必须严格匹配规范，否则下游 import 失败。",
    "4. 不要在两段之外加任何额外文字。",
    "",
    "## 场景元数据",
    "```json",
    JSON.stringify(transcript.scene, null, 2),
    "```",
    "",
    "## 角色",
    transcript.characters
      .map((c: any) => `- ${c.id}${c.name && c.name !== c.id ? `（${c.name}）` : ""}`)
      .join("\n"),
    "",
    "## 对话原文（多 Agent 并行扮演产物）",
    "```json",
    JSON.stringify(transcript.rounds, null, 2),
    "```",
  ].join("\n");

  const client = new OpenAI({ apiKey, baseURL: BASE_URL });
  console.log(`rendering with ${MODEL} @ ${BASE_URL} ...`);

  const resp = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [
      { role: "system", content: spec },
      { role: "user", content: userPrompt },
    ],
  });

  const text = resp.choices?.[0]?.message?.content ?? "";

  const outDir = args.out
    ? isAbsolute(args.out)
      ? args.out
      : resolve(process.cwd(), args.out)
    : join(REPO_ROOT, "screenplays");
  await mkdir(outDir, { recursive: true });

  const mdPath = join(outDir, `${args.session}.md`);
  await writeFile(mdPath, text + "\n", "utf8");
  console.log(`storyboard md → ${mdPath}`);

  const json = extractJsonBlock(text);
  if (json) {
    const jsonPath = join(outDir, `${args.session}.json`);
    await writeFile(jsonPath, JSON.stringify(json, null, 2) + "\n", "utf8");
    console.log(`storyboard json → ${jsonPath} (${Array.isArray(json) ? json.length : "?"} shots)`);
  } else {
    console.warn("⚠️  no parseable ```json``` block found; only Markdown was saved.");
    console.warn("    inspect the .md, then re-run after fixing the prompt or model output.");
  }

  if (resp.usage) {
    console.log(
      `usage: prompt=${resp.usage.prompt_tokens} completion=${resp.usage.completion_tokens} total=${resp.usage.total_tokens}`,
    );
  }
}

function extractJsonBlock(s: string): unknown | null {
  const m = s.match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
