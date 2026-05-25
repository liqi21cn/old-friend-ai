/**
 * Singleton MySQL pool + drizzle wrapper. Schema is auto-initialized on first
 * import via ensureSchema(); idempotent so re-imports are safe.
 *
 * drizzle-orm/mysql2 expects the *callback* API pool (mysql2.createPool).
 * For our own ensureSchema queries we pull the promise wrapper via pool.promise().
 *
 * Env:
 *   DATABASE_URL=mysql://root:123456@127.0.0.1:3306/person_skills
 */
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __pkPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __pkDb: MySql2Database<typeof schema> | undefined;
  // eslint-disable-next-line no-var
  var __pkSchemaReady: Promise<void> | undefined;
}

function pool(): Pool {
  if (!global.__pkPool) {
    const url =
      process.env.DATABASE_URL ||
      "mysql://root:123456@127.0.0.1:3306/person_skills";
    global.__pkPool = mysql.createPool({
      uri: url,
      connectionLimit: 10,
      charset: "utf8mb4",
      enableKeepAlive: true,
      timezone: "+08:00",
    });
  }
  return global.__pkPool;
}

export function db(): MySql2Database<typeof schema> {
  if (!global.__pkDb) {
    global.__pkDb = drizzle(pool(), { schema, mode: "default" });
  }
  return global.__pkDb;
}

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS characters (
    id varchar(64) NOT NULL PRIMARY KEY,
    name varchar(128) NOT NULL,
    type enum('real','fictional') NOT NULL,
    era varchar(64) DEFAULT '',
    tags json,
    portrait varchar(1024),
    portrait_source varchar(64),
    source_work varchar(256),
    relations json,
    skill longtext NOT NULL,
    skill_path varchar(256) NOT NULL,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_type (type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id varchar(32) NOT NULL PRIMARY KEY,
    user_id int,
    kind varchar(32) NOT NULL,
    title varchar(256) NOT NULL,
    status enum('pending','running','done','failed','cancelled') NOT NULL DEFAULT 'pending',
    total int NOT NULL DEFAULT 0,
    done_count int NOT NULL DEFAULT 0,
    failed_count int NOT NULL DEFAULT 0,
    skipped_count int NOT NULL DEFAULT 0,
    concurrency int NOT NULL DEFAULT 1,
    payload json,
    result json,
    error text,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at datetime,
    finished_at datetime,
    INDEX idx_status (status),
    INDEX idx_kind (kind),
    INDEX idx_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS job_items (
    id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
    job_id varchar(32) NOT NULL,
    row_index int NOT NULL,
    target_id varchar(64),
    label varchar(256) NOT NULL,
    status enum('queued','running','done','failed','skipped') NOT NULL DEFAULT 'queued',
    message text,
    started_at datetime,
    finished_at datetime,
    INDEX idx_job (job_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS transcripts (
    session_id varchar(32) NOT NULL PRIMARY KEY,
    user_id int,
    scene json, characters json, rounds json, narration text,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS screenplays (
    session_id varchar(32) NOT NULL PRIMARY KEY,
    user_id int,
    shots json, markdown longtext,
    episode int DEFAULT 1, scene_no int DEFAULT 1,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS screenplay_assets (
    id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id varchar(32) NOT NULL,
    user_id int,
    kind enum('character','scene','prop') NOT NULL,
    name varchar(256) NOT NULL,
    prompt text,
    image_url longtext,
    image_source varchar(64),
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_session_kind_name (session_id, kind, name),
    INDEX idx_session (session_id),
    INDEX idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export async function ensureSchema(): Promise<void> {
  if (global.__pkSchemaReady) return global.__pkSchemaReady;
  global.__pkSchemaReady = (async () => {
    const p = pool().promise();
    const conn = await p.getConnection();
    try {
      for (const sql of SCHEMA_SQL) {
        await conn.query(sql);
      }
    } finally {
      conn.release();
    }
  })();
  return global.__pkSchemaReady;
}
