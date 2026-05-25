/**
 * CLI wrapper around the multi-Agent dialogue orchestrator.
 *
 *   pnpm tsx scripts/run-dialogue.ts \
 *     --chars jobs,musk \
 *     --scene tests/scenes/mars-vs-iphone.yaml \
 *     --rounds 3
 */
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { runDialogue, saveTranscript, type Scene, type CharacterRef } from "../skills/对话编排/scripts/run.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

interface Args {
  chars: string[];
  scene: string;
  rounds: number;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--chars") a.chars = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--scene") a.scene = argv[++i];
    else if (k === "--rounds") a.rounds = Number(argv[++i]);
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--help" || k === "-h") {
      printUsageAndExit(0);
    } else {
      console.error(`unknown arg: ${k}`);
      printUsageAndExit(2);
    }
  }
  if (!a.chars || a.chars.length < 2 || !a.scene || !a.rounds || a.rounds < 1) {
    printUsageAndExit(2);
  }
  return a as Args;
}

function printUsageAndExit(code: number): never {
  console.error(
    [
      "usage: tsx scripts/run-dialogue.ts \\",
      "         --chars <id1,id2[,id3,...]> \\",
      "         --scene <path/to/scene.yaml> \\",
      "         --rounds <N> \\",
      "         [--out <dir>]",
      "",
      "Character ids must exist in characters/index.json — run `tsx scripts/index-characters.ts` first.",
    ].join("\n"),
  );
  process.exit(code);
}

interface IndexEntry {
  id: string;
  name: string;
  type: string;
  skill_path: string;
}

async function loadCharacterRefs(ids: string[]): Promise<CharacterRef[]> {
  const indexPath = join(REPO_ROOT, "characters/index.json");
  let index: IndexEntry[];
  try {
    index = JSON.parse(await readFile(indexPath, "utf8"));
  } catch (e) {
    console.error(`failed to read ${indexPath}: ${(e as Error).message}`);
    console.error("hint: run `pnpm tsx scripts/index-characters.ts` after adding characters.");
    process.exit(2);
  }

  const refs: CharacterRef[] = [];
  for (const id of ids) {
    const hit = index.find((x) => x.id === id);
    if (!hit) {
      console.error(`character not in index: "${id}"`);
      console.error(`known ids: ${index.map((x) => x.id).join(", ") || "(empty)"}`);
      process.exit(2);
    }
    refs.push({ id: hit.id, name: hit.name, skillPath: hit.skill_path });
  }
  return refs;
}

async function loadScene(pathArg: string): Promise<Scene> {
  const p = isAbsolute(pathArg) ? pathArg : resolve(process.cwd(), pathArg);
  const raw = await readFile(p, "utf8");
  const obj = parseYaml(raw);
  if (!obj || typeof obj !== "object") throw new Error(`scene yaml is not an object: ${p}`);
  const scene = obj as Partial<Scene>;
  for (const k of ["setting", "conflict", "goal"] as const) {
    if (typeof scene[k] !== "string" || !scene[k]) {
      throw new Error(`scene yaml missing required field: ${k}`);
    }
  }
  return {
    setting: scene.setting!,
    conflict: scene.conflict!,
    goal: scene.goal!,
    opener: typeof scene.opener === "string" ? scene.opener : undefined,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const refs = await loadCharacterRefs(args.chars);
  const scene = await loadScene(args.scene);

  console.log(`# 多 Agent 对话开始`);
  console.log(`角色：${refs.map((r) => r.name ?? r.id).join(" / ")}`);
  console.log(`场景：${scene.setting}`);
  console.log(`冲突：${scene.conflict}`);
  console.log(`目标：${scene.goal}`);
  console.log("");

  const transcript = await runDialogue({
    characters: refs,
    scene,
    rounds: args.rounds,
    repoRoot: REPO_ROOT,
    onTurn: (round, turn) => {
      const act = turn.action ? `（${turn.action}）` : "";
      console.log(`[轮${round}] ${turn.speaker}${act}: ${turn.text}`);
    },
  });

  const outDir = args.out
    ? isAbsolute(args.out) ? args.out : resolve(process.cwd(), args.out)
    : join(REPO_ROOT, "transcripts");
  const path = await saveTranscript(transcript, outDir);
  console.log("");
  console.log(`transcript saved → ${path}`);
  console.log(`sessionId: ${transcript.sessionId}`);
  console.log(`next: pnpm tsx scripts/render-screenplay.ts --session ${transcript.sessionId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
