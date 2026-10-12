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
  deleteResponses(formId: string, ids: string[]): Promise<void>;
  saveFile(file: StoredFile, data: Buffer): Promise<void>;
  getFile(id: string): Promise<StoredFile | null>;
  readFile(id: string): Promise<Buffer | null>;
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
    `);
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
          .prepare("INSERT INTO users (id, email, name, password_hash, password_changed_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(u.id, u.email, u.name, u.passwordHash, u.passwordChangedAt, u.createdAt);
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
    ready ??= client
      .unsafe(
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
        CREATE INDEX IF NOT EXISTS clayform_forms_owner ON clayform_forms(owner_id, updated_at);`,
      )
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
      const rows = await q`INSERT INTO clayform_users (id, email, name, password_hash, password_changed_at, created_at)
        VALUES (${u.id}, ${u.email}, ${u.name}, ${u.passwordHash}, ${u.passwordChangedAt}, ${u.createdAt})
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
export const deleteResponses = (formId: string, ids: string[]) => s().deleteResponses(formId, ids);
export const saveFile = (file: StoredFile, data: Buffer) => s().saveFile(file, data);
export const getFile = (id: string) => s().getFile(id);
export const readStoredFile = (id: string) => s().readFile(id);
