/**
 * Drizzle schema for MySQL 8/9 + utf8mb4.
 *
 * Design notes:
 * - `characters.skill` stores SKILL.md verbatim. The filesystem mirror
 *   (characters/<type>/<id>/SKILL.md) is a side effect, kept in sync but
 *   not authoritative — re-importing from FS into DB is supported via
 *   scripts/migrate-fs-to-db.ts.
 * - `jobs` is generic so it serves any long-running batch (currently only
 *   batch-distillation, but avatar-refresh and dialogue runs can plug in
 *   the same machinery later).
 * - JSON columns use MySQL native JSON type for queryability via JSON_*.
 */
import {
  mysqlTable,
  varchar,
  text,
  longtext,
  json,
  datetime,
  int,
  mysqlEnum,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const characters = mysqlTable(
  "characters",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    type: mysqlEnum("type", ["real", "fictional"]).notNull(),
    era: varchar("era", { length: 64 }).default(""),
    tags: json("tags").$type<string[]>().default([]),
    portrait: varchar("portrait", { length: 1024 }),
    portraitSource: varchar("portrait_source", { length: 64 }), // wikipedia-zh|wikipedia-en|wikidata|placeholder
    sourceWork: varchar("source_work", { length: 256 }),
    relations: json("relations")
      .$type<Array<{ target: string; type: string; status: string }>>()
      .default([]),
    skill: longtext("skill").notNull(),
    skillPath: varchar("skill_path", { length: 256 }).notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
  },
  (t) => ({
    typeIdx: index("idx_type").on(t.type),
  }),
);

export const jobs = mysqlTable(
  "jobs",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    userId: int("user_id"),
    kind: varchar("kind", { length: 32 }).notNull(), // batch-distill | avatar-refresh | dialogue | ...
    title: varchar("title", { length: 256 }).notNull(),
    status: mysqlEnum("status", [
      "pending",
      "running",
      "done",
      "failed",
      "cancelled",
    ])
      .notNull()
      .default("pending"),
    total: int("total").notNull().default(0),
    doneCount: int("done_count").notNull().default(0),
    failedCount: int("failed_count").notNull().default(0),
    skippedCount: int("skipped_count").notNull().default(0),
    concurrency: int("concurrency").notNull().default(1),
    payload: json("payload").$type<unknown>(),
    result: json("result").$type<unknown>(),
    error: text("error"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    startedAt: datetime("started_at"),
    finishedAt: datetime("finished_at"),
  },
  (t) => ({
    statusIdx: index("idx_status").on(t.status),
    kindIdx: index("idx_kind").on(t.kind),
    userIdx: index("idx_user_id").on(t.userId),
  }),
);

export const jobItems = mysqlTable(
  "job_items",
  {
    id: int("id").autoincrement().primaryKey(),
    jobId: varchar("job_id", { length: 32 }).notNull(),
    rowIndex: int("row_index").notNull(),
    targetId: varchar("target_id", { length: 64 }), // characters.id, transcripts.session_id, etc
    label: varchar("label", { length: 256 }).notNull(),
    status: mysqlEnum("status", [
      "queued",
      "running",
      "done",
      "failed",
      "skipped",
    ])
      .notNull()
      .default("queued"),
    message: text("message"),
    startedAt: datetime("started_at"),
    finishedAt: datetime("finished_at"),
  },
  (t) => ({
    jobIdx: index("idx_job").on(t.jobId),
  }),
);

export const transcripts = mysqlTable("transcripts", {
  sessionId: varchar("session_id", { length: 32 }).primaryKey(),
  userId: int("user_id"),
  scene: json("scene").$type<{
    setting: string;
    conflict: string;
    goal: string;
    opener?: string;
  }>(),
  characters: json("characters").$type<
    Array<{ id: string; name?: string; skillPath?: string }>
  >(),
  rounds: json("rounds").$type<
    Array<{
      round: number;
      turns: Array<{ speaker: string; text: string; action: string | null }>;
    }>
  >(),
  narration: text("narration"),
  createdAt: datetime("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
});

export const screenplays = mysqlTable("screenplays", {
  sessionId: varchar("session_id", { length: 32 }).primaryKey(),
  userId: int("user_id"),
  shots: json("shots").$type<unknown[]>(),
  markdown: longtext("markdown"),
  episode: int("episode").default(1),
  sceneNo: int("scene_no").default(1),
  createdAt: datetime("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const screenplayAssets = mysqlTable(
  "screenplay_assets",
  {
    id: int("id").autoincrement().primaryKey(),
    sessionId: varchar("session_id", { length: 32 }).notNull(),
    userId: int("user_id"),
    kind: mysqlEnum("kind", ["character", "scene", "prop"]).notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    prompt: text("prompt"),
    imageUrl: longtext("image_url"),
    imageSource: varchar("image_source", { length: 64 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
  },
  (t) => ({
    sessionIdx: index("idx_session").on(t.sessionId),
    userIdx: index("idx_user").on(t.userId),
  }),
);

export type AssetRow = typeof screenplayAssets.$inferSelect;

export type CharacterRow = typeof characters.$inferSelect;
export type NewCharacterRow = typeof characters.$inferInsert;
export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
export type JobItemRow = typeof jobItems.$inferSelect;
export type NewJobItemRow = typeof jobItems.$inferInsert;
