/**
 * One-shot migration: walk characters/<type>/<id>/{SKILL.md, meta.json} on disk
 * and upsert into MySQL. Safe to re-run (idempotent via INSERT ... ON DUPLICATE KEY UPDATE).
 *
 *   pnpm tsx scripts/import-fs-to-db.ts
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadEnv({ path: resolve(__dirname, "../.env") });

import { ensureSchema } from "../lib/db/client";
import { writeNewCharacter, type CharacterMeta } from "../lib/repo";

const REPO_ROOT = resolve(__dirname, "../..");
const CHARACTERS_DIR = join(REPO_ROOT, "characters");

async function safeReaddir(p: string): Promise<string[]> {
  try {
    return await readdir(p);
  } catch {
    return [];
  }
}

async function main() {
  await ensureSchema();
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const type of ["real", "fictional"] as const) {
    const typeDir = join(CHARACTERS_DIR, type);
    const ids = await safeReaddir(typeDir);

    for (const id of ids) {
      if (id.startsWith(".")) continue;
      const dir = join(typeDir, id);
      const metaPath = join(dir, "meta.json");
      const skillPath = join(dir, "SKILL.md");

      try {
        const metaStat = await stat(metaPath).catch(() => null);
        const skillStat = await stat(skillPath).catch(() => null);
        if (!metaStat?.isFile() || !skillStat?.isFile()) {
          console.warn(`[skip] ${type}/${id}: missing meta.json or SKILL.md`);
          skipped++;
          continue;
        }

        const meta = JSON.parse(await readFile(metaPath, "utf8")) as CharacterMeta;
        const skill = await readFile(skillPath, "utf8");

        meta.type = meta.type ?? type;
        meta.skill_path = meta.skill_path ?? `characters/${type}/${id}/SKILL.md`;

        await writeNewCharacter(meta, skill);
        console.log(`✓ ${type}/${id}  (${meta.name})`);
        imported++;
      } catch (e: any) {
        console.error(`✗ ${type}/${id}: ${e.message}`);
        failed++;
      }
    }
  }

  console.log(`\nimported=${imported}  skipped=${skipped}  failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
