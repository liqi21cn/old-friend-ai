/**
 * Repository layer — MySQL authoritative, filesystem mirror as read-only artefact
 * for Claude Code skill packs.
 *
 * - read* helpers query MySQL exclusively.
 * - writeCharacter / writeNewCharacter writes both DB and characters/<type>/<id>/.
 * - File mirror failures are logged but do not block DB writes (DB is the truth).
 */
import { resolve, dirname, join } from "node:path";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { eq, sql, and } from "drizzle-orm";
import { db, ensureSchema } from "./db/client";
import {
  characters as charactersTable,
  transcripts as transcriptsTable,
  screenplays as screenplaysTable,
  screenplayAssets as screenplayAssetsTable,
  type CharacterRow as DbCharacterRow,
} from "./db/schema";

export const REPO_ROOT = resolve(process.cwd(), "..");
export const CHARACTERS_DIR = join(REPO_ROOT, "characters");
export const TRANSCRIPTS_DIR = join(REPO_ROOT, "transcripts");
export const SCREENPLAYS_DIR = join(REPO_ROOT, "screenplays");

export interface CharacterMeta {
  id: string;
  name: string;
  type: "real" | "fictional";
  era?: string;
  tags?: string[];
  portrait?: string | null;
  portrait_source?: string | null;
  source_work?: string | null;
  relations?: Array<{ target: string; type: string; status: string }>;
  skill_path: string;
}

function rowToMeta(r: DbCharacterRow): CharacterMeta {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    era: r.era || "",
    tags: (r.tags as string[]) || [],
    portrait: r.portrait,
    portrait_source: r.portraitSource,
    source_work: r.sourceWork,
    relations: (r.relations as CharacterMeta["relations"]) || [],
    skill_path: r.skillPath,
  };
}

export async function readIndex(
  opts: { orderBy?: "id" | "created_desc" } = {},
): Promise<CharacterMeta[]> {
  await ensureSchema();
  const order = opts.orderBy ?? "id";
  const q = db().select().from(charactersTable);
  const rows =
    order === "created_desc"
      ? await q.orderBy(sql`${charactersTable.createdAt} DESC, ${charactersTable.id} ASC`)
      : await q.orderBy(charactersTable.id);
  return rows.map(rowToMeta);
}

export async function readCharacter(id: string): Promise<{
  meta: CharacterMeta;
  skill: string;
} | null> {
  await ensureSchema();
  const rows = await db()
    .select()
    .from(charactersTable)
    .where(eq(charactersTable.id, id))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { meta: rowToMeta(r), skill: r.skill };
}

export async function writeCharacterSkill(id: string, skill: string): Promise<void> {
  await ensureSchema();
  const meta = await readCharacter(id);
  if (!meta) throw new Error(`character not found: ${id}`);
  await db()
    .update(charactersTable)
    .set({ skill })
    .where(eq(charactersTable.id, id));
  await mirrorSkillToFs(meta.meta, skill).catch((e) =>
    console.warn(`[repo] FS mirror failed for ${id}:`, e.message),
  );
}

export async function writeNewCharacter(
  meta: CharacterMeta,
  skill: string,
): Promise<void> {
  await ensureSchema();
  meta.skill_path = meta.skill_path || `characters/${meta.type}/${meta.id}/SKILL.md`;

  await db()
    .insert(charactersTable)
    .values({
      id: meta.id,
      name: meta.name,
      type: meta.type,
      era: meta.era || "",
      tags: meta.tags || [],
      portrait: meta.portrait ?? null,
      portraitSource: meta.portrait_source ?? null,
      sourceWork: meta.source_work ?? null,
      relations: meta.relations || [],
      skill,
      skillPath: meta.skill_path,
    })
    .onDuplicateKeyUpdate({
      set: {
        name: meta.name,
        type: meta.type,
        era: meta.era || "",
        tags: meta.tags || [],
        portrait: meta.portrait ?? null,
        portraitSource: meta.portrait_source ?? null,
        sourceWork: meta.source_work ?? null,
        relations: meta.relations || [],
        skill,
        skillPath: meta.skill_path,
      },
    });

  await mirrorSkillToFs(meta, skill).catch((e) =>
    console.warn(`[repo] FS mirror failed for ${meta.id}:`, e.message),
  );
}

export async function updateCharacterPortrait(
  id: string,
  portrait: string,
  source: string,
): Promise<void> {
  await ensureSchema();
  await db()
    .update(charactersTable)
    .set({ portrait, portraitSource: source })
    .where(eq(charactersTable.id, id));
}

export async function deleteCharacter(id: string): Promise<void> {
  await ensureSchema();
  const c = await readCharacter(id);
  if (!c) return;
  await db().delete(charactersTable).where(eq(charactersTable.id, id));
  // Best-effort FS cleanup
  try {
    const dir = dirname(join(REPO_ROOT, c.meta.skill_path));
    await rm(dir, { recursive: true, force: true });
  } catch (e: any) {
    console.warn(`[repo] FS cleanup failed for ${id}:`, e.message);
  }
}

async function mirrorSkillToFs(meta: CharacterMeta, skill: string): Promise<void> {
  const dir = join(CHARACTERS_DIR, meta.type, meta.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skill, "utf8");
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify(
      {
        id: meta.id,
        name: meta.name,
        type: meta.type,
        era: meta.era || "",
        tags: meta.tags || [],
        portrait: meta.portrait ?? null,
        source_work: meta.source_work ?? null,
        relations: meta.relations || [],
        skill_path: meta.skill_path,
      },
      null,
      2,
    ),
    "utf8",
  );
  // Update index.json for legacy CLI users
  const all = await readIndex();
  await writeFile(
    join(CHARACTERS_DIR, "index.json"),
    JSON.stringify(
      all.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        era: c.era || "",
        tags: c.tags || [],
        portrait: c.portrait ?? null,
        source_work: c.source_work ?? null,
        relations: c.relations || [],
        skill_path: c.skill_path,
      })),
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

// ===== Transcripts (user-scoped) =====
//
// All transcript / screenplay rows belong to the user that created them.
// Reads always match user_id AND session_id — a user requesting another
// user's session id gets null, identical to "not found".

export async function readTranscript(
  sessionId: string,
  userId: number,
): Promise<any | null> {
  await ensureSchema();
  const rows = await db()
    .select()
    .from(transcriptsTable)
    .where(
      and(
        eq(transcriptsTable.sessionId, sessionId),
        eq(transcriptsTable.userId, userId),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  // Normalize datetime to ISO string — mysql2 returns Date objects for
  // DATETIME columns, but the client UI sorts/formats startedAt as a string.
  return {
    sessionId: r.sessionId,
    startedAt:
      r.createdAt instanceof Date
        ? r.createdAt.toISOString()
        : typeof r.createdAt === "string"
        ? r.createdAt
        : null,
    scene: r.scene,
    characters: r.characters,
    rounds: r.rounds,
    narration: r.narration,
  };
}

export async function writeTranscript(
  sessionId: string,
  userId: number,
  transcript: any,
): Promise<void> {
  await ensureSchema();
  await db()
    .insert(transcriptsTable)
    .values({
      sessionId,
      userId,
      scene: transcript.scene,
      characters: transcript.characters,
      rounds: transcript.rounds,
      narration: transcript.narration ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        scene: transcript.scene,
        characters: transcript.characters,
        rounds: transcript.rounds,
        narration: transcript.narration ?? null,
      },
    });
  // FS mirror for CLI compatibility
  try {
    await mkdir(TRANSCRIPTS_DIR, { recursive: true });
    await writeFile(
      join(TRANSCRIPTS_DIR, `${sessionId}.json`),
      JSON.stringify(transcript, null, 2),
      "utf8",
    );
  } catch (e: any) {
    console.warn(`[repo] transcript FS mirror failed:`, e.message);
  }
}

export async function listSessions(userId: number): Promise<string[]> {
  await ensureSchema();
  const rows = await db()
    .select({ id: transcriptsTable.sessionId })
    .from(transcriptsTable)
    .where(eq(transcriptsTable.userId, userId));
  return rows.map((r) => r.id);
}

// ===== Screenplays (user-scoped) =====

export async function readScreenplay(
  sessionId: string,
  userId: number,
): Promise<unknown[] | null> {
  await ensureSchema();
  const rows = await db()
    .select()
    .from(screenplaysTable)
    .where(
      and(
        eq(screenplaysTable.sessionId, sessionId),
        eq(screenplaysTable.userId, userId),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return (r.shots as unknown[]) || null;
}

export async function writeScreenplay(
  sessionId: string,
  userId: number,
  shots: unknown[],
  markdown: string,
  episode = 1,
  sceneNo = 1,
): Promise<void> {
  await ensureSchema();
  await db()
    .insert(screenplaysTable)
    .values({ sessionId, userId, shots, markdown, episode, sceneNo })
    .onDuplicateKeyUpdate({
      set: { shots, markdown, episode, sceneNo },
    });
  try {
    await mkdir(SCREENPLAYS_DIR, { recursive: true });
    await writeFile(
      join(SCREENPLAYS_DIR, `${sessionId}.json`),
      JSON.stringify(shots, null, 2),
      "utf8",
    );
    await writeFile(
      join(SCREENPLAYS_DIR, `${sessionId}.md`),
      markdown,
      "utf8",
    );
  } catch (e: any) {
    console.warn(`[repo] screenplay FS mirror failed:`, e.message);
  }
}

export async function readScreenplayMarkdown(
  sessionId: string,
  userId: number,
): Promise<string | null> {
  await ensureSchema();
  const rows = await db()
    .select({ markdown: screenplaysTable.markdown })
    .from(screenplaysTable)
    .where(
      and(
        eq(screenplaysTable.sessionId, sessionId),
        eq(screenplaysTable.userId, userId),
      ),
    )
    .limit(1);
  return rows[0]?.markdown ?? null;
}

// ===== Screenplay assets (user-scoped, per session) =====

export interface SessionAsset {
  kind: "character" | "scene" | "prop";
  name: string;
  prompt: string | null;
  imageUrl: string | null;
  imageSource: string | null;
  updatedAt?: Date | null;
}

export async function readSessionAssets(
  sessionId: string,
  userId: number,
): Promise<SessionAsset[]> {
  await ensureSchema();
  const rows = await db()
    .select()
    .from(screenplayAssetsTable)
    .where(
      and(
        eq(screenplayAssetsTable.sessionId, sessionId),
        eq(screenplayAssetsTable.userId, userId),
      ),
    );
  return rows.map((r) => ({
    kind: r.kind,
    name: r.name,
    prompt: r.prompt,
    imageUrl: r.imageUrl,
    imageSource: r.imageSource,
    updatedAt: r.updatedAt,
  }));
}

export async function upsertSessionAsset(
  sessionId: string,
  userId: number,
  input: {
    kind: "character" | "scene" | "prop";
    name: string;
    prompt?: string | null;
    imageUrl?: string | null;
    imageSource?: string | null;
  },
): Promise<void> {
  await ensureSchema();
  await db()
    .insert(screenplayAssetsTable)
    .values({
      sessionId,
      userId,
      kind: input.kind,
      name: input.name,
      prompt: input.prompt ?? null,
      imageUrl: input.imageUrl ?? null,
      imageSource: input.imageSource ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        // PATCH semantics: only overwrite columns the caller explicitly set
        // (undefined means "leave existing value alone"). We rely on the
        // upsert hitting the unique (session_id, kind, name) index.
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.imageSource !== undefined
          ? { imageSource: input.imageSource }
          : {}),
        // Always tick userId so legacy rows without owner get associated
        userId,
      },
    });
}

export async function deleteSessionAsset(
  sessionId: string,
  userId: number,
  kind: "character" | "scene" | "prop",
  name: string,
): Promise<void> {
  await ensureSchema();
  await db()
    .delete(screenplayAssetsTable)
    .where(
      and(
        eq(screenplayAssetsTable.sessionId, sessionId),
        eq(screenplayAssetsTable.userId, userId),
        eq(screenplayAssetsTable.kind, kind),
        eq(screenplayAssetsTable.name, name),
      ),
    );
}
