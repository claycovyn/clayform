// Storage: one SQLite file using Node's built-in driver (no native modules,
// no database server). Forms and responses are stored as JSON documents.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync as DB } from "node:sqlite";
import type { Form, FormStats, ResponseRecord } from "./types";

export const DATA_DIR = path.resolve(process.env.CLAYFORM_DATA_DIR || "./data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

let db: DB | null = null;

function open(): DB {
  if (db) return db;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  // getBuiltinModule keeps the bundler from trying to resolve node:sqlite.
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  db = new DatabaseSync(path.join(DATA_DIR, "clayform.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS forms (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      doc TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS responses (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      resume_hash TEXT NOT NULL,
      doc TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS responses_form ON responses(form_id, updated_at);
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

type Row = Record<string, unknown>;

export function listForms(): (Form & { stats: FormStats })[] {
  const rows = open()
    .prepare(
      `SELECT f.doc, f.views,
        (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id) AS starts,
        (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id AND r.completed_at IS NOT NULL) AS completes
       FROM forms f ORDER BY f.updated_at DESC`,
    )
    .all() as Row[];
  return rows.map((r) => ({
    ...(JSON.parse(String(r.doc)) as Form),
    stats: { views: Number(r.views), starts: Number(r.starts), completes: Number(r.completes) },
  }));
}

export function getForm(id: string): Form | null {
  const row = open().prepare("SELECT doc FROM forms WHERE id = ?").get(id) as Row | undefined;
  return row ? (JSON.parse(String(row.doc)) as Form) : null;
}

export function getFormBySlug(slug: string): Form | null {
  const row = open().prepare("SELECT doc FROM forms WHERE slug = ?").get(slug) as Row | undefined;
  return row ? (JSON.parse(String(row.doc)) as Form) : null;
}

export function slugTaken(slug: string, exceptId?: string): boolean {
  const row = open().prepare("SELECT id FROM forms WHERE slug = ?").get(slug) as Row | undefined;
  return !!row && row.id !== exceptId;
}

export function saveForm(form: Form): void {
  open()
    .prepare(
      `INSERT INTO forms (id, slug, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, doc = excluded.doc, updated_at = excluded.updated_at`,
    )
    .run(form.id, form.slug, JSON.stringify(form), form.createdAt, form.updatedAt);
}

export function deleteForm(id: string): void {
  const files = open().prepare("SELECT id FROM files WHERE form_id = ?").all(id) as Row[];
  for (const f of files) fs.rmSync(path.join(UPLOAD_DIR, String(f.id)), { force: true });
  open().prepare("DELETE FROM forms WHERE id = ?").run(id);
}

export function countView(formId: string): void {
  open().prepare("UPDATE forms SET views = views + 1 WHERE id = ?").run(formId);
}

export function formStats(formId: string): FormStats {
  const r = open()
    .prepare(
      `SELECT f.views,
        (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id) AS starts,
        (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id AND r.completed_at IS NOT NULL) AS completes
       FROM forms f WHERE f.id = ?`,
    )
    .get(formId) as Row | undefined;
  return { views: Number(r?.views ?? 0), starts: Number(r?.starts ?? 0), completes: Number(r?.completes ?? 0) };
}

export function getResponse(id: string): { response: ResponseRecord; resumeHash: string } | null {
  const row = open().prepare("SELECT doc, resume_hash FROM responses WHERE id = ?").get(id) as Row | undefined;
  return row ? { response: JSON.parse(String(row.doc)) as ResponseRecord, resumeHash: String(row.resume_hash) } : null;
}

export function saveResponse(response: ResponseRecord, resumeHash: string): void {
  open()
    .prepare(
      `INSERT INTO responses (id, form_id, resume_hash, doc, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, completed_at = excluded.completed_at, updated_at = excluded.updated_at`,
    )
    .run(response.id, response.formId, resumeHash, JSON.stringify(response), response.completedAt, response.updatedAt);
}

export function listResponses(formId: string): ResponseRecord[] {
  const rows = open()
    .prepare("SELECT doc FROM responses WHERE form_id = ? ORDER BY updated_at DESC")
    .all(formId) as Row[];
  return rows.map((r) => JSON.parse(String(r.doc)) as ResponseRecord);
}

export function deleteResponses(formId: string, ids: string[]): void {
  const stmt = open().prepare("DELETE FROM responses WHERE form_id = ? AND id = ?");
  for (const id of ids) stmt.run(formId, id);
}

export function saveFile(file: { id: string; formId: string; name: string; type: string; size: number }): void {
  open()
    .prepare("INSERT INTO files (id, form_id, name, type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(file.id, file.formId, file.name, file.type, file.size, new Date().toISOString());
}

export function getFile(id: string): { id: string; formId: string; name: string; type: string; size: number } | null {
  const row = open().prepare("SELECT * FROM files WHERE id = ?").get(id) as Row | undefined;
  if (!row) return null;
  return { id: String(row.id), formId: String(row.form_id), name: String(row.name), type: String(row.type), size: Number(row.size) };
}
