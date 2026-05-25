/**
 * Walk characters/{real,fictional}/<id>/meta.json and rebuild characters/index.json.
 * Run after adding/editing any character — run-dialogue.ts resolves character ids
 * through the index, not by directly scanning the filesystem.
 */
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, "..");
const CHAR_DIR = join(REPO_ROOT, "characters");

interface CharacterMeta {
  id: string;
  name: string;
  type: "real" | "fictional";
  era?: string;
  tags?: string[];
  portrait?: string | null;
  source_work?: string | null;
  relations?: Array<{ target: string; type: string; status: string }>;
  skill_path: string;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function main() {
  const entries: CharacterMeta[] = [];
  const seenIds = new Set<string>();
  const warnings: string[] = [];

  for (const type of ["real", "fictional"] as const) {
    const typeDir = join(CHAR_DIR, type);
    const ids = await safeReaddir(typeDir);

    for (const id of ids) {
      if (id.startsWith(".")) continue;
      const metaPath = join(typeDir, id, "meta.json");
      const skillPath = join(typeDir, id, "SKILL.md");

      if (!(await isFile(metaPath))) continue;
      if (!(await isFile(skillPath))) {
        warnings.push(`[skip] ${type}/${id}: meta.json present but SKILL.md missing`);
        continue;
      }

      let meta: CharacterMeta;
      try {
        meta = JSON.parse(await readFile(metaPath, "utf8")) as CharacterMeta;
      } catch (e) {
        warnings.push(`[skip] ${type}/${id}: meta.json parse error — ${(e as Error).message}`);
        continue;
      }

      meta.type = meta.type ?? type;
      meta.skill_path = meta.skill_path ?? `characters/${type}/${id}/SKILL.md`;

      if (!meta.id || !meta.name) {
        warnings.push(`[skip] ${type}/${id}: meta.json missing id or name`);
        continue;
      }
      if (meta.id !== id) {
        warnings.push(`[warn] ${type}/${id}: meta.id="${meta.id}" disagrees with folder name`);
      }
      if (seenIds.has(meta.id)) {
        warnings.push(`[skip] duplicate id "${meta.id}"`);
        continue;
      }
      seenIds.add(meta.id);
      entries.push(meta);
    }
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));

  const outPath = join(CHAR_DIR, "index.json");
  await writeFile(outPath, JSON.stringify(entries, null, 2) + "\n", "utf8");

  console.log(`indexed ${entries.length} character(s) → ${outPath}`);
  for (const w of warnings) console.warn(w);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
