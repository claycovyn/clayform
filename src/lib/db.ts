// Storage. Two drivers behind one async interface:
//  - Postgres when DATABASE_URL (or POSTGRES_URL) is set — Vercel, Neon, Supabase, any host.
//  - SQLite otherwise, using Node's built-in driver: one file, no database server.
// Forms and responses are stored as JSON documents; uploads live in the database
// (Postgres) or on disk next to the SQLite file.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Sql } from "postgres";
import type { Form, FormStats, ResponseRecord } from "./types";

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  /** Changing the password signs out every other session. */
  passwordChangedAt: string;
  createdAt: string;
  /** Cloud plan: "free" | "cloud" | "grandfathered" ("pro" is read as "cloud"). Only enforced when CLAYFORM_CLOUD=1. */
  plan?: string;
  /** Set when the person clicked the link in the verification email. */
  emailVerifiedAt?: string | null;
}

/** One metered quantity for one workspace on one UTC day. */
export interface UsageRow {
  userId: string;
  day: string;
  metric: string;
  amount: number;
}

export interface AbuseReport {
  id: string;
  formId: string;
  reason: string;
  details: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  plan: string;
  createdAt: string;
  forms: number;
  storageBytes: number;
  emailVerified: boolean;
}

/** An API key for agents and scripts. Only the SHA-256 of the secret is stored. */
export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  /** First characters of the key, shown so people can tell keys apart. */
  prefix: string;
  hash: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ResponseQuery {
  limit: number;
  /** Opaque cursor from a previous page. */
  cursor?: string;
  /** ISO time: only responses updated at or after it. */
  since?: string;
  completedOnly?: boolean;
}

export interface ResponsePage {
  responses: ResponseRecord[];
  nextCursor: string | null;
}

export interface StoredFile {
  id: string;
  formId: string;
  name: string;
  type: string;
  size: number;
}

interface Store {
  createUser(user: User): Promise<boolean>;
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  updateUser(id: string, patch: Partial<Pick<User, "name" | "passwordHash" | "passwordChangedAt">>): Promise<void>;
  deleteUser(id: string): Promise<void>;
  /** Forms made before accounts existed go to the first person who signs up. */
  claimOrphanForms(userId: string): Promise<void>;
  listForms(ownerId: string): Promise<(Form & { stats: FormStats })[]>;
  getForm(id: string): Promise<Form | null>;
  formOwner(id: string): Promise<string | null>;
  getFormBySlug(slug: string): Promise<Form | null>;
  slugTaken(slug: string, exceptId?: string): Promise<boolean>;
  /** Inserts with the owner, or updates the document of an existing form (owner unchanged). */
  saveForm(form: Form, ownerId: string): Promise<void>;
  deleteForm(id: string): Promise<void>;
  countView(formId: string): Promise<void>;
  formStats(formId: string): Promise<FormStats>;
  getResponse(id: string): Promise<{ response: ResponseRecord; resumeHash: string } | null>;
  saveResponse(response: ResponseRecord, resumeHash: string): Promise<void>;
  listResponses(formId: string): Promise<ResponseRecord[]>;
  /** Newest first (by last update), paged with a cursor. */
  queryResponses(formId: string, q: ResponseQuery): Promise<ResponsePage>;
  deleteResponses(formId: string, ids: string[]): Promise<void>;
  saveFile(file: StoredFile, data: Buffer): Promise<void>;
  getFile(id: string): Promise<StoredFile | null>;
  readFile(id: string): Promise<Buffer | null>;
  createApiKey(key: ApiKey): Promise<void>;
  listApiKeys(userId: string): Promise<ApiKey[]>;
  getApiKeyByHash(hash: string): Promise<ApiKey | null>;
  /** Returns false when the key doesn't exist, isn't this user's, or is already revoked. */
  revokeApiKey(userId: string, id: string): Promise<boolean>;
  touchApiKey(id: string, at: string): Promise<void>;
  setUserPlan(id: string, plan: string): Promise<void>;
  /** Adds to a workspace's counter for that UTC day. */
  addUsage(userId: string, metric: string, amount: number, day: string): Promise<void>;
  /** Usage rows between two UTC days (inclusive); one user, or everyone. */
  usage(fromDay: string, toDay: string, userId?: string): Promise<UsageRow[]>;
  /** Every workspace with its form count and stored bytes (form and response documents plus uploads). */
  adminUsers(): Promise<AdminUserRow[]>;
  createReport(r: AbuseReport): Promise<void>;
  listReports(openOnly: boolean): Promise<AbuseReport[]>;
  resolveReport(id: string, resolution: string): Promise<void>;
  setTakedown(formId: string, reason: string | null): Promise<void>;
  getTakedown(formId: string): Promise<{ reason: string; createdAt: string } | null>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  /** Stored bytes for one workspace: form and response documents plus uploads. */
  storageBytes(userId: string): Promise<number>;
  setEmailVerified(id: string, at: string): Promise<void>;
  /** Published forms with their owner, for abuse scans. */
  publishedForms(): Promise<{ form: Form; ownerId: string | null }[]>;
}

export const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

/** On Vercel (and similar) the disk is temporary, so SQLite would silently lose data. */
export function storageProblem(): string | null {
  if (!DATABASE_URL && process.env.VERCEL)
    return "Clayform needs a Postgres database on Vercel. Add one under Storage (Neon or Supabase), then redeploy.";
  return null;
}

type Row = Record<string, unknown>;
const toStats = (r: Row | undefined): FormStats => ({
  views: Number(r?.views ?? 0),
  starts: Number(r?.starts ?? 0),
  completes: Number(r?.completes ?? 0),
});
// Postgres returns Date objects; String(date) would drop the milliseconds.
const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();
const toUser = (r: Row): User => ({
  id: String(r.id),
  email: String(r.email),
  name: String(r.name),
  passwordHash: String(r.password_hash),
  passwordChangedAt: iso(r.password_changed_at),
  createdAt: iso(r.created_at),
  plan: r.plan ? String(r.plan) : "grandfathered",
  emailVerifiedAt: r.email_verified_at ? iso(r.email_verified_at) : null,
});
const toReport = (r: Row): AbuseReport => ({
  id: String(r.id),
  formId: String(r.form_id),
  reason: String(r.reason),
  details: String(r.details),
  createdAt: iso(r.created_at),
  resolvedAt: r.resolved_at ? iso(r.resolved_at) : null,
  resolution: r.resolution ? String(r.resolution) : null,
});
const toFile = (r: Row): StoredFile => ({
  id: String(r.id),
  formId: String(r.form_id),
  name: String(r.name),
  type: String(r.type),
  size: Number(r.size),
});
// Postgres returns jsonb as objects; SQLite returns text.
const doc = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;
const toKey = (r: Row): ApiKey => ({
  id: String(r.id),
  userId: String(r.user_id),
  name: String(r.name),
  prefix: String(r.prefix),
  hash: String(r.hash),
  scopes: doc<string[]>(r.scopes),
  createdAt: iso(r.created_at),
  lastUsedAt: r.last_used_at ? iso(r.last_used_at) : null,
  revokedAt: r.revoked_at ? iso(r.revoked_at) : null,
});

// Response cursors encode the last row's (updated_at, id), the sort key.
export function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify([updatedAt, id])).toString("base64url");
}
export function decodeCursor(cursor: string): { updatedAt: string; id: string } | null {
  try {
    const [updatedAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof updatedAt !== "string" || typeof id !== "string" || Number.isNaN(Date.parse(updatedAt))) return null;
    return { updatedAt: new Date(updatedAt).toISOString(), id };
  } catch {
    return null;
  }
}
function page(rows: ResponseRecord[], limit: number): ResponsePage {
  const more = rows.length > limit;
  const responses = more ? rows.slice(0, limit) : rows;
  const last = responses[responses.length - 1];
  return { responses, nextCursor: more && last ? encodeCursor(last.updatedAt, last.id) : null };
}

// ---- SQLite ----------------------------------------------------------------

function sqliteStore(): Store {
  const dataDir = path.resolve(process.env.CLAYFORM_DATA_DIR || "./data");
  const uploadDir = path.join(dataDir, "uploads");
  let handle: DatabaseSync | null = null;

  const db = (): DatabaseSync => {
    if (handle) return handle;
    fs.mkdirSync(uploadDir, { recursive: true });
    // getBuiltinModule keeps the bundler from trying to resolve node:sqlite.
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
    handle = new DatabaseSync(path.join(dataDir, "clayform.db"));
    handle.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
        password_changed_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS forms (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, doc TEXT NOT NULL,
        views INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS responses (
        id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
        resume_hash TEXT NOT NULL, doc TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS responses_form ON responses(form_id, updated_at);
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
        name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL,
        created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS api_keys_user ON api_keys(user_id, created_at);
      CREATE TABLE IF NOT EXISTS usage_daily (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, metric TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day, metric)
      );
      CREATE INDEX IF NOT EXISTS usage_daily_day ON usage_daily(day);
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE, reason TEXT NOT NULL,
        details TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, resolution TEXT
      );
      CREATE TABLE IF NOT EXISTS takedowns (
        form_id TEXT PRIMARY KEY REFERENCES forms(id) ON DELETE CASCADE, reason TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    // Accounts that existed before Cloud plans keep no limits ("grandfathered"); new ones get a plan at sign-up.
    const userCols = handle.prepare("PRAGMA table_info(users)").all() as Row[];
    if (!userCols.some((c) => c.name === "plan")) handle.exec("ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'grandfathered'");
    if (!userCols.some((c) => c.name === "email_verified_at")) handle.exec("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
    // Installs from before accounts existed: add the owner column.
    const cols = handle.prepare("PRAGMA table_info(forms)").all() as Row[];
    if (!cols.some((c) => c.name === "owner_id")) {
      handle.exec("ALTER TABLE forms ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE CASCADE");
    }
    handle.exec("CREATE INDEX IF NOT EXISTS forms_owner ON forms(owner_id, updated_at)");
    return handle;
  };
  const removeUploads = (where: string, arg: string) => {
    const files = db().prepare(`SELECT id FROM files WHERE ${where}`).all(arg) as Row[];
    for (const f of files) fs.rmSync(path.join(uploadDir, String(f.id)), { force: true });
  };
  const statsSql = `SELECT f.views,
      (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id) AS starts,
      (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id AND r.completed_at IS NOT NULL) AS completes
    FROM forms f`;

  return {
    async createUser(u) {
      try {
        db()
          .prepare("INSERT INTO users (id, email, name, password_hash, password_changed_at, created_at, plan) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(u.id, u.email, u.name, u.passwordHash, u.passwordChangedAt, u.createdAt, u.plan ?? "grandfathered");
        return true;
      } catch (e) {
        if (String((e as Error).message).includes("UNIQUE")) return false;
        throw e;
      }
    },
    async getUser(id) {
      const r = db().prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
      return r ? toUser(r) : null;
    },
    async getUserByEmail(email) {
      const r = db().prepare("SELECT * FROM users WHERE email = ?").get(email) as Row | undefined;
      return r ? toUser(r) : null;
    },
    async updateUser(id, patch) {
      const u = (await this.getUser(id))!;
      db()
        .prepare("UPDATE users SET name = ?, password_hash = ?, password_changed_at = ? WHERE id = ?")
        .run(patch.name ?? u.name, patch.passwordHash ?? u.passwordHash, patch.passwordChangedAt ?? u.passwordChangedAt, id);
    },
    async deleteUser(id) {
      removeUploads("form_id IN (SELECT id FROM forms WHERE owner_id = ?)", id);
      db().prepare("DELETE FROM users WHERE id = ?").run(id);
    },
    async claimOrphanForms(userId) {
      db().prepare("UPDATE forms SET owner_id = ? WHERE owner_id IS NULL").run(userId);
    },
    async listForms(ownerId) {
      const rows = db()
        .prepare(`${statsSql.replace("SELECT f.views", "SELECT f.doc, f.views")} WHERE f.owner_id = ? ORDER BY f.updated_at DESC`)
        .all(ownerId) as Row[];
      return rows.map((r) => ({ ...doc<Form>(r.doc), stats: toStats(r) }));
    },
    async getForm(id) {
      const r = db().prepare("SELECT doc FROM forms WHERE id = ?").get(id) as Row | undefined;
      return r ? doc<Form>(r.doc) : null;
    },
    async formOwner(id) {
      const r = db().prepare("SELECT owner_id FROM forms WHERE id = ?").get(id) as Row | undefined;
      return r?.owner_id ? String(r.owner_id) : null;
    },
    async getFormBySlug(slug) {
      const r = db().prepare("SELECT doc FROM forms WHERE slug = ?").get(slug) as Row | undefined;
      return r ? doc<Form>(r.doc) : null;
    },
    async slugTaken(slug, exceptId) {
      const r = db().prepare("SELECT id FROM forms WHERE slug = ?").get(slug) as Row | undefined;
      return !!r && r.id !== exceptId;
    },
    async saveForm(form, ownerId) {
      db()
        .prepare(
          `INSERT INTO forms (id, slug, doc, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, doc = excluded.doc, updated_at = excluded.updated_at`,
        )
        .run(form.id, form.slug, JSON.stringify(form), ownerId, form.createdAt, form.updatedAt);
    },
    async deleteForm(id) {
      removeUploads("form_id = ?", id);
      db().prepare("DELETE FROM forms WHERE id = ?").run(id);
    },
    async countView(formId) {
      db().prepare("UPDATE forms SET views = views + 1 WHERE id = ?").run(formId);
    },
    async formStats(formId) {
      return toStats(db().prepare(`${statsSql} WHERE f.id = ?`).get(formId) as Row | undefined);
    },
    async getResponse(id) {
      const r = db().prepare("SELECT doc, resume_hash FROM responses WHERE id = ?").get(id) as Row | undefined;
      return r ? { response: doc<ResponseRecord>(r.doc), resumeHash: String(r.resume_hash) } : null;
    },
    async saveResponse(response, resumeHash) {
      db()
        .prepare(
          `INSERT INTO responses (id, form_id, resume_hash, doc, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, completed_at = excluded.completed_at, updated_at = excluded.updated_at`,
        )
        .run(response.id, response.formId, resumeHash, JSON.stringify(response), response.completedAt, response.updatedAt);
    },
    async listResponses(formId) {
      const rows = db().prepare("SELECT doc FROM responses WHERE form_id = ? ORDER BY updated_at DESC").all(formId) as Row[];
      return rows.map((r) => doc<ResponseRecord>(r.doc));
    },
    async queryResponses(formId, q) {
      const where = ["form_id = ?"];
      const args: (string | number)[] = [formId];
      if (q.completedOnly) where.push("completed_at IS NOT NULL");
      if (q.since) {
        where.push("updated_at >= ?");
        args.push(new Date(q.since).toISOString());
      }
      const c = q.cursor ? decodeCursor(q.cursor) : null;
      if (c) {
        where.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
        args.push(c.updatedAt, c.updatedAt, c.id);
      }
      const rows = db()
        .prepare(`SELECT doc FROM responses WHERE ${where.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT ?`)
        .all(...args, q.limit + 1) as Row[];
      return page(rows.map((r) => doc<ResponseRecord>(r.doc)), q.limit);
    },
    async deleteResponses(formId, ids) {
      const stmt = db().prepare("DELETE FROM responses WHERE form_id = ? AND id = ?");
      for (const id of ids) stmt.run(formId, id);
    },
    async saveFile(file, data) {
      db();
      await fs.promises.writeFile(path.join(uploadDir, file.id), data);
      db()
        .prepare("INSERT INTO files (id, form_id, name, type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(file.id, file.formId, file.name, file.type, file.size, new Date().toISOString());
    },
    async getFile(id) {
      const r = db().prepare("SELECT * FROM files WHERE id = ?").get(id) as Row | undefined;
      return r ? toFile(r) : null;
    },
    async readFile(id) {
      return fs.promises.readFile(path.join(uploadDir, id)).catch(() => null);
    },
    async createApiKey(k) {
      db()
        .prepare("INSERT INTO api_keys (id, user_id, name, prefix, hash, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(k.id, k.userId, k.name, k.prefix, k.hash, JSON.stringify(k.scopes), k.createdAt);
    },
    async listApiKeys(userId) {
      const rows = db().prepare("SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC").all(userId) as Row[];
      return rows.map(toKey);
    },
    async getApiKeyByHash(hash) {
      const r = db().prepare("SELECT * FROM api_keys WHERE hash = ?").get(hash) as Row | undefined;
      return r ? toKey(r) : null;
    },
    async revokeApiKey(userId, id) {
      const r = db()
        .prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
        .run(new Date().toISOString(), id, userId);
      return Number(r.changes) === 1;
    },
    async touchApiKey(id, at) {
      db().prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(at, id);
    },
    async setUserPlan(id, plan) {
      db().prepare("UPDATE users SET plan = ? WHERE id = ?").run(plan, id);
    },
    async addUsage(userId, metric, amount, day) {
      db()
        .prepare("INSERT INTO usage_daily (user_id, day, metric, amount) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, day, metric) DO UPDATE SET amount = amount + excluded.amount")
        .run(userId, day, metric, amount);
    },
    async usage(fromDay, toDay, userId) {
      const rows = (userId
        ? db().prepare("SELECT * FROM usage_daily WHERE day >= ? AND day <= ? AND user_id = ?").all(fromDay, toDay, userId)
        : db().prepare("SELECT * FROM usage_daily WHERE day >= ? AND day <= ?").all(fromDay, toDay)) as Row[];
      return rows.map((r) => ({ userId: String(r.user_id), day: String(r.day), metric: String(r.metric), amount: Number(r.amount) }));
    },
    async adminUsers() {
      const rows = db()
        .prepare(
          `SELECT u.id, u.email, u.name, u.plan, u.created_at, u.email_verified_at,
            (SELECT COUNT(*) FROM forms f WHERE f.owner_id = u.id) AS forms,
            COALESCE((SELECT SUM(LENGTH(f.doc)) FROM forms f WHERE f.owner_id = u.id), 0)
            + COALESCE((SELECT SUM(LENGTH(r.doc)) FROM responses r JOIN forms f ON f.id = r.form_id WHERE f.owner_id = u.id), 0)
            + COALESCE((SELECT SUM(x.size) FROM files x JOIN forms f ON f.id = x.form_id WHERE f.owner_id = u.id), 0) AS bytes
          FROM users u ORDER BY u.created_at`,
        )
        .all() as Row[];
      return rows.map((r) => ({ id: String(r.id), email: String(r.email), name: String(r.name), plan: String(r.plan), createdAt: iso(r.created_at), forms: Number(r.forms), storageBytes: Number(r.bytes), emailVerified: !!r.email_verified_at }));
    },
    async createReport(r) {
      db().prepare("INSERT INTO reports (id, form_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?)").run(r.id, r.formId, r.reason, r.details, r.createdAt);
    },
    async listReports(openOnly) {
      const rows = db().prepare(`SELECT * FROM reports ${openOnly ? "WHERE resolved_at IS NULL" : ""} ORDER BY created_at DESC LIMIT 500`).all() as Row[];
      return rows.map(toReport);
    },
    async resolveReport(id, resolution) {
      db().prepare("UPDATE reports SET resolved_at = ?, resolution = ? WHERE id = ?").run(new Date().toISOString(), resolution, id);
    },
    async setTakedown(formId, reason) {
      if (reason === null) db().prepare("DELETE FROM takedowns WHERE form_id = ?").run(formId);
      else db().prepare("INSERT INTO takedowns (form_id, reason, created_at) VALUES (?, ?, ?) ON CONFLICT(form_id) DO UPDATE SET reason = excluded.reason").run(formId, reason, new Date().toISOString());
    },
    async getTakedown(formId) {
      const r = db().prepare("SELECT reason, created_at FROM takedowns WHERE form_id = ?").get(formId) as Row | undefined;
      return r ? { reason: String(r.reason), createdAt: iso(r.created_at) } : null;
    },
    async getSetting(key) {
      const r = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
      return r ? String(r.value) : null;
    },
    async setSetting(key, value) {
      db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
    },
    async storageBytes(userId) {
      const r = db()
        .prepare(
          `SELECT COALESCE((SELECT SUM(LENGTH(f.doc)) FROM forms f WHERE f.owner_id = ?), 0)
            + COALESCE((SELECT SUM(LENGTH(r.doc)) FROM responses r JOIN forms f ON f.id = r.form_id WHERE f.owner_id = ?), 0)
            + COALESCE((SELECT SUM(x.size) FROM files x JOIN forms f ON f.id = x.form_id WHERE f.owner_id = ?), 0) AS bytes`,
        )
        .get(userId, userId, userId) as Row;
      return Number(r.bytes);
    },
    async setEmailVerified(id, at) {
      db().prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(at, id);
    },
    async publishedForms() {
      const rows = db().prepare("SELECT doc, owner_id FROM forms WHERE json_extract(doc, '$.status') = 'published' ORDER BY updated_at DESC LIMIT 2000").all() as Row[];
      return rows.map((r) => ({ form: doc<Form>(r.doc), ownerId: r.owner_id ? String(r.owner_id) : null }));
    },
  };
}

// ---- Postgres --------------------------------------------------------------

function postgresStore(url: string): Store {
  let client: Sql | null = null;
  let ready: Promise<void> | null = null;

  const sql = async (): Promise<Sql> => {
    if (!client) {
      const { default: postgres } = await import("postgres");
      // prepare:false keeps it compatible with poolers (Neon, Supabase, PgBouncer).
      client = postgres(url, { max: 3, prepare: false, idle_timeout: 20, onnotice: () => {} });
    }
    const c = client;
    // An advisory lock serialises schema setup, so instances starting at the same time on a fresh database don't
    // race each other's CREATE TABLE IF NOT EXISTS.
    ready ??= c
      .begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(483921)`;
        await tx.unsafe(
        `CREATE TABLE IF NOT EXISTS clayform_users (
          id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
          password_changed_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clayform_forms (
          id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, doc JSONB NOT NULL,
          views INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clayform_responses (
          id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES clayform_forms(id) ON DELETE CASCADE,
          resume_hash TEXT NOT NULL, doc JSONB NOT NULL, completed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS clayform_responses_form ON clayform_responses(form_id, updated_at);
        CREATE TABLE IF NOT EXISTS clayform_files (
          id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES clayform_forms(id) ON DELETE CASCADE,
          name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, data BYTEA NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        ALTER TABLE clayform_forms ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES clayform_users(id) ON DELETE CASCADE;
        CREATE INDEX IF NOT EXISTS clayform_forms_owner ON clayform_forms(owner_id, updated_at);
        CREATE TABLE IF NOT EXISTS clayform_api_keys (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES clayform_users(id) ON DELETE CASCADE,
          name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, scopes JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL, last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS clayform_api_keys_user ON clayform_api_keys(user_id, created_at);
        ALTER TABLE clayform_users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'grandfathered';
        ALTER TABLE clayform_users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
        CREATE TABLE IF NOT EXISTS clayform_usage_daily (
          user_id TEXT NOT NULL REFERENCES clayform_users(id) ON DELETE CASCADE, day TEXT NOT NULL, metric TEXT NOT NULL,
          amount BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day, metric)
        );
        CREATE INDEX IF NOT EXISTS clayform_usage_daily_day ON clayform_usage_daily(day);
        CREATE TABLE IF NOT EXISTS clayform_reports (
          id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES clayform_forms(id) ON DELETE CASCADE, reason TEXT NOT NULL,
          details TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, resolved_at TIMESTAMPTZ, resolution TEXT
        );
        CREATE TABLE IF NOT EXISTS clayform_takedowns (
          form_id TEXT PRIMARY KEY REFERENCES clayform_forms(id) ON DELETE CASCADE, reason TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS clayform_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
        );
      })
      .then(() => undefined)
      .catch((e) => {
        ready = null;
        throw e;
      });
    await ready;
    return client;
  };

  const stats = (q: Sql) => q`
    f.views,
    (SELECT COUNT(*) FROM clayform_responses r WHERE r.form_id = f.id) AS starts,
    (SELECT COUNT(*) FROM clayform_responses r WHERE r.form_id = f.id AND r.completed_at IS NOT NULL) AS completes`;

  return {
    async createUser(u) {
      const q = await sql();
      const rows = await q`INSERT INTO clayform_users (id, email, name, password_hash, password_changed_at, created_at, plan)
        VALUES (${u.id}, ${u.email}, ${u.name}, ${u.passwordHash}, ${u.passwordChangedAt}, ${u.createdAt}, ${u.plan ?? "grandfathered"})
        ON CONFLICT (email) DO NOTHING RETURNING id`;
      return rows.length === 1;
    },
    async getUser(id) {
      const q = await sql();
      const [r] = await q`SELECT * FROM clayform_users WHERE id = ${id}`;
      return r ? toUser(r) : null;
    },
    async getUserByEmail(email) {
      const q = await sql();
      const [r] = await q`SELECT * FROM clayform_users WHERE email = ${email}`;
      return r ? toUser(r) : null;
    },
    async updateUser(id, patch) {
      const q = await sql();
      await q`UPDATE clayform_users SET
        name = COALESCE(${patch.name ?? null}, name),
        password_hash = COALESCE(${patch.passwordHash ?? null}, password_hash),
        password_changed_at = COALESCE(${patch.passwordChangedAt ?? null}::timestamptz, password_changed_at)
        WHERE id = ${id}`;
    },
    async deleteUser(id) {
      const q = await sql();
      await q`DELETE FROM clayform_users WHERE id = ${id}`;
    },
    async claimOrphanForms(userId) {
      const q = await sql();
      await q`UPDATE clayform_forms SET owner_id = ${userId} WHERE owner_id IS NULL`;
    },
    async listForms(ownerId) {
      const q = await sql();
      const rows = await q`SELECT f.doc, ${stats(q)} FROM clayform_forms f WHERE f.owner_id = ${ownerId} ORDER BY f.updated_at DESC`;
      return rows.map((r) => ({ ...doc<Form>(r.doc), stats: toStats(r) }));
    },
    async formOwner(id) {
      const q = await sql();
      const [r] = await q`SELECT owner_id FROM clayform_forms WHERE id = ${id}`;
      return r?.owner_id ? String(r.owner_id) : null;
    },
    async getForm(id) {
      const q = await sql();
      const [r] = await q`SELECT doc FROM clayform_forms WHERE id = ${id}`;
      return r ? doc<Form>(r.doc) : null;
    },
    async getFormBySlug(slug) {
      const q = await sql();
      const [r] = await q`SELECT doc FROM clayform_forms WHERE slug = ${slug}`;
      return r ? doc<Form>(r.doc) : null;
    },
    async slugTaken(slug, exceptId) {
      const q = await sql();
      const [r] = await q`SELECT id FROM clayform_forms WHERE slug = ${slug}`;
      return !!r && r.id !== exceptId;
    },
    async saveForm(form, ownerId) {
      const q = await sql();
      await q`INSERT INTO clayform_forms (id, slug, doc, owner_id, created_at, updated_at)
        VALUES (${form.id}, ${form.slug}, ${q.json(JSON.parse(JSON.stringify(form)))}, ${ownerId}, ${form.createdAt}, ${form.updatedAt})
        ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at`;
    },
    async deleteForm(id) {
      const q = await sql();
      await q`DELETE FROM clayform_forms WHERE id = ${id}`;
    },
    async countView(formId) {
      const q = await sql();
      await q`UPDATE clayform_forms SET views = views + 1 WHERE id = ${formId}`;
    },
    async formStats(formId) {
      const q = await sql();
      const [r] = await q`SELECT ${stats(q)} FROM clayform_forms f WHERE f.id = ${formId}`;
      return toStats(r);
    },
    async getResponse(id) {
      const q = await sql();
      const [r] = await q`SELECT doc, resume_hash FROM clayform_responses WHERE id = ${id}`;
      return r ? { response: doc<ResponseRecord>(r.doc), resumeHash: String(r.resume_hash) } : null;
    },
    async saveResponse(response, resumeHash) {
      const q = await sql();
      await q`INSERT INTO clayform_responses (id, form_id, resume_hash, doc, completed_at, updated_at)
        VALUES (${response.id}, ${response.formId}, ${resumeHash}, ${q.json(JSON.parse(JSON.stringify(response)))},
                ${response.completedAt}, ${response.updatedAt})
        ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, completed_at = EXCLUDED.completed_at, updated_at = EXCLUDED.updated_at`;
    },
    async listResponses(formId) {
      const q = await sql();
      const rows = await q`SELECT doc FROM clayform_responses WHERE form_id = ${formId} ORDER BY updated_at DESC`;
      return rows.map((r) => doc<ResponseRecord>(r.doc));
    },
    async queryResponses(formId, qr) {
      const q = await sql();
      const c = qr.cursor ? decodeCursor(qr.cursor) : null;
      const rows = await q`SELECT doc FROM clayform_responses WHERE form_id = ${formId}
        ${qr.completedOnly ? q`AND completed_at IS NOT NULL` : q``}
        ${qr.since ? q`AND updated_at >= ${new Date(qr.since).toISOString()}::timestamptz` : q``}
        ${c ? q`AND (updated_at < ${c.updatedAt}::timestamptz OR (updated_at = ${c.updatedAt}::timestamptz AND id < ${c.id}))` : q``}
        ORDER BY updated_at DESC, id DESC LIMIT ${qr.limit + 1}`;
      return page(rows.map((r) => doc<ResponseRecord>(r.doc)), qr.limit);
    },
    async deleteResponses(formId, ids) {
      if (!ids.length) return;
      const q = await sql();
      await q`DELETE FROM clayform_responses WHERE form_id = ${formId} AND id IN ${q(ids)}`;
    },
    async saveFile(file, data) {
      const q = await sql();
      await q`INSERT INTO clayform_files (id, form_id, name, type, size, data)
        VALUES (${file.id}, ${file.formId}, ${file.name}, ${file.type}, ${file.size}, ${data})`;
    },
    async getFile(id) {
      const q = await sql();
      const [r] = await q`SELECT id, form_id, name, type, size FROM clayform_files WHERE id = ${id}`;
      return r ? toFile(r) : null;
    },
    async readFile(id) {
      const q = await sql();
      const [r] = await q`SELECT data FROM clayform_files WHERE id = ${id}`;
      return r ? Buffer.from(r.data as Uint8Array) : null;
    },
    async createApiKey(k) {
      const q = await sql();
      await q`INSERT INTO clayform_api_keys (id, user_id, name, prefix, hash, scopes, created_at)
        VALUES (${k.id}, ${k.userId}, ${k.name}, ${k.prefix}, ${k.hash}, ${q.json(k.scopes)}, ${k.createdAt})`;
    },
    async listApiKeys(userId) {
      const q = await sql();
      const rows = await q`SELECT * FROM clayform_api_keys WHERE user_id = ${userId} ORDER BY created_at DESC`;
      return rows.map(toKey);
    },
    async getApiKeyByHash(hash) {
      const q = await sql();
      const [r] = await q`SELECT * FROM clayform_api_keys WHERE hash = ${hash}`;
      return r ? toKey(r) : null;
    },
    async revokeApiKey(userId, id) {
      const q = await sql();
      const rows = await q`UPDATE clayform_api_keys SET revoked_at = now()
        WHERE id = ${id} AND user_id = ${userId} AND revoked_at IS NULL RETURNING id`;
      return rows.length === 1;
    },
    async touchApiKey(id, at) {
      const q = await sql();
      await q`UPDATE clayform_api_keys SET last_used_at = ${at} WHERE id = ${id}`;
    },
    async setUserPlan(id, plan) {
      const q = await sql();
      await q`UPDATE clayform_users SET plan = ${plan} WHERE id = ${id}`;
    },
    async addUsage(userId, metric, amount, day) {
      const q = await sql();
      await q`INSERT INTO clayform_usage_daily (user_id, day, metric, amount) VALUES (${userId}, ${day}, ${metric}, ${amount})
        ON CONFLICT (user_id, day, metric) DO UPDATE SET amount = clayform_usage_daily.amount + EXCLUDED.amount`;
    },
    async usage(fromDay, toDay, userId) {
      const q = await sql();
      const rows = await q`SELECT * FROM clayform_usage_daily WHERE day >= ${fromDay} AND day <= ${toDay} ${userId ? q`AND user_id = ${userId}` : q``}`;
      return rows.map((r) => ({ userId: String(r.user_id), day: String(r.day), metric: String(r.metric), amount: Number(r.amount) }));
    },
    async adminUsers() {
      const q = await sql();
      const rows = await q`SELECT u.id, u.email, u.name, u.plan, u.created_at, u.email_verified_at,
          (SELECT COUNT(*) FROM clayform_forms f WHERE f.owner_id = u.id) AS forms,
          COALESCE((SELECT SUM(octet_length(f.doc::text)) FROM clayform_forms f WHERE f.owner_id = u.id), 0)
          + COALESCE((SELECT SUM(octet_length(r.doc::text)) FROM clayform_responses r JOIN clayform_forms f ON f.id = r.form_id WHERE f.owner_id = u.id), 0)
          + COALESCE((SELECT SUM(x.size) FROM clayform_files x JOIN clayform_forms f ON f.id = x.form_id WHERE f.owner_id = u.id), 0) AS bytes
        FROM clayform_users u ORDER BY u.created_at`;
      return rows.map((r) => ({ id: String(r.id), email: String(r.email), name: String(r.name), plan: String(r.plan), createdAt: iso(r.created_at), forms: Number(r.forms), storageBytes: Number(r.bytes), emailVerified: !!r.email_verified_at }));
    },
    async createReport(r) {
      const q = await sql();
      await q`INSERT INTO clayform_reports (id, form_id, reason, details, created_at) VALUES (${r.id}, ${r.formId}, ${r.reason}, ${r.details}, ${r.createdAt})`;
    },
    async listReports(openOnly) {
      const q = await sql();
      const rows = await q`SELECT * FROM clayform_reports ${openOnly ? q`WHERE resolved_at IS NULL` : q``} ORDER BY created_at DESC LIMIT 500`;
      return rows.map(toReport);
    },
    async resolveReport(id, resolution) {
      const q = await sql();
      await q`UPDATE clayform_reports SET resolved_at = now(), resolution = ${resolution} WHERE id = ${id}`;
    },
    async setTakedown(formId, reason) {
      const q = await sql();
      if (reason === null) await q`DELETE FROM clayform_takedowns WHERE form_id = ${formId}`;
      else await q`INSERT INTO clayform_takedowns (form_id, reason) VALUES (${formId}, ${reason}) ON CONFLICT (form_id) DO UPDATE SET reason = EXCLUDED.reason`;
    },
    async getTakedown(formId) {
      const q = await sql();
      const [r] = await q`SELECT reason, created_at FROM clayform_takedowns WHERE form_id = ${formId}`;
      return r ? { reason: String(r.reason), createdAt: iso(r.created_at) } : null;
    },
    async getSetting(key) {
      const q = await sql();
      const [r] = await q`SELECT value FROM clayform_settings WHERE key = ${key}`;
      return r ? String(r.value) : null;
    },
    async setSetting(key, value) {
      const q = await sql();
      await q`INSERT INTO clayform_settings (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    },
    async storageBytes(userId) {
      const q = await sql();
      const [r] = await q`SELECT
          COALESCE((SELECT SUM(octet_length(f.doc::text)) FROM clayform_forms f WHERE f.owner_id = ${userId}), 0)
          + COALESCE((SELECT SUM(octet_length(r.doc::text)) FROM clayform_responses r JOIN clayform_forms f ON f.id = r.form_id WHERE f.owner_id = ${userId}), 0)
          + COALESCE((SELECT SUM(x.size) FROM clayform_files x JOIN clayform_forms f ON f.id = x.form_id WHERE f.owner_id = ${userId}), 0) AS bytes`;
      return Number(r.bytes);
    },
    async setEmailVerified(id, at) {
      const q = await sql();
      await q`UPDATE clayform_users SET email_verified_at = ${at} WHERE id = ${id}`;
    },
    async publishedForms() {
      const q = await sql();
      const rows = await q`SELECT doc, owner_id FROM clayform_forms WHERE doc->>'status' = 'published' ORDER BY updated_at DESC LIMIT 2000`;
      return rows.map((r) => ({ form: doc<Form>(r.doc), ownerId: r.owner_id ? String(r.owner_id) : null }));
    },
  };
}

let store: Store | null = null;
function s(): Store {
  const problem = storageProblem();
  if (problem) throw new Error(problem);
  store ??= DATABASE_URL ? postgresStore(DATABASE_URL) : sqliteStore();
  return store;
}

export const createUser = (user: User) => s().createUser(user);
export const getUser = (id: string) => s().getUser(id);
export const getUserByEmail = (email: string) => s().getUserByEmail(email);
export const updateUser = (id: string, patch: Parameters<Store["updateUser"]>[1]) => s().updateUser(id, patch);
export const deleteUser = (id: string) => s().deleteUser(id);
export const claimOrphanForms = (userId: string) => s().claimOrphanForms(userId);
export const listForms = (ownerId: string) => s().listForms(ownerId);
export const getForm = (id: string) => s().getForm(id);
export const formOwner = (id: string) => s().formOwner(id);
/** The form, but only if this user owns it. */
export async function getOwnedForm(id: string, userId: string): Promise<Form | null> {
  if ((await formOwner(id)) !== userId) return null;
  return getForm(id);
}
export const getFormBySlug = (slug: string) => s().getFormBySlug(slug);
export const slugTaken = (slug: string, exceptId?: string) => s().slugTaken(slug, exceptId);
export const saveForm = (form: Form, ownerId: string) => s().saveForm(form, ownerId);
export const deleteForm = (id: string) => s().deleteForm(id);
export const countView = (formId: string) => s().countView(formId);
export const formStats = (formId: string) => s().formStats(formId);
export const getResponse = (id: string) => s().getResponse(id);
export const saveResponse = (response: ResponseRecord, resumeHash: string) => s().saveResponse(response, resumeHash);
export const listResponses = (formId: string) => s().listResponses(formId);
export const queryResponses = (formId: string, q: ResponseQuery) => s().queryResponses(formId, q);
export const deleteResponses = (formId: string, ids: string[]) => s().deleteResponses(formId, ids);
export const saveFile = (file: StoredFile, data: Buffer) => s().saveFile(file, data);
export const getFile = (id: string) => s().getFile(id);
export const readStoredFile = (id: string) => s().readFile(id);
export const createApiKey = (key: ApiKey) => s().createApiKey(key);
export const listApiKeys = (userId: string) => s().listApiKeys(userId);
export const getApiKeyByHash = (hash: string) => s().getApiKeyByHash(hash);
export const revokeApiKey = (userId: string, id: string) => s().revokeApiKey(userId, id);
export const touchApiKey = (id: string, at: string) => s().touchApiKey(id, at);
export const setUserPlan = (id: string, plan: string) => s().setUserPlan(id, plan);
export const addUsage = (userId: string, metric: string, amount: number, day: string) => s().addUsage(userId, metric, amount, day);
export const usageRows = (fromDay: string, toDay: string, userId?: string) => s().usage(fromDay, toDay, userId);
export const adminUsers = () => s().adminUsers();
export const createReport = (r: AbuseReport) => s().createReport(r);
export const listReports = (openOnly = true) => s().listReports(openOnly);
export const resolveReport = (id: string, resolution: string) => s().resolveReport(id, resolution);
export const setTakedown = (formId: string, reason: string | null) => s().setTakedown(formId, reason);
export const getTakedown = (formId: string) => s().getTakedown(formId);
export const getSetting = (key: string) => s().getSetting(key);
export const setSetting = (key: string, value: string) => s().setSetting(key, value);
export const publishedForms = () => s().publishedForms();
export const storageBytes = (userId: string) => s().storageBytes(userId);
export const setEmailVerified = (id: string, at: string) => s().setEmailVerified(id, at);
