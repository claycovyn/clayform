// API keys let AI agents and scripts use Clayform on someone's behalf (REST API and the MCP server).
// Format: "cf_" + 32 random bytes (base64url). Only the SHA-256 of the whole key is stored; the key is shown once.
import "server-only";
import crypto from "node:crypto";
import { createApiKey, getApiKeyByHash, getUser, touchApiKey, type ApiKey, type User } from "./db";
import { uid } from "./fields";

export const SCOPES = {
  "forms:read": "See your forms and their share links",
  "forms:write": "Create, edit, publish and delete forms",
  "responses:read": "Read responses, stats, exports and uploaded files",
  "responses:delete": "Delete responses",
  "webhooks:write": "Set and test webhooks",
} as const;
export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];
/** Everything except deleting responses, which has to be asked for. */
export const DEFAULT_SCOPES: Scope[] = ["forms:read", "forms:write", "responses:read", "webhooks:write"];

export const KEY_PREFIX = "cf_";
const KEY_RE = /^cf_[A-Za-z0-9_-]{43}$/;
/** Don't write last_used_at more than once a minute per key. */
const TOUCH_EVERY_MS = 60_000;

export function isScope(s: string): s is Scope {
  return s in SCOPES;
}

export function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/** Creates a key for the user. The returned `secret` is the only time the full key exists outside the caller. */
export async function issueApiKey(userId: string, name: string, scopes: Scope[]): Promise<{ key: ApiKey; secret: string }> {
  const secret = KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
  const key: ApiKey = {
    id: uid(),
    userId,
    name: name.trim().slice(0, 80) || "API key",
    prefix: secret.slice(0, KEY_PREFIX.length + 8),
    hash: hashKey(secret),
    scopes: [...new Set(scopes)],
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };
  await createApiKey(key);
  return { key, secret };
}

/** The token from "Authorization: Bearer …", or null when there's no bearer header. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  return m ? m[1] : "";
}

/** The key's owner and scopes, or null for a malformed, unknown or revoked key. */
export async function verifyApiKey(token: string): Promise<{ user: User; key: ApiKey } | null> {
  if (!KEY_RE.test(token)) return null;
  const key = await getApiKeyByHash(hashKey(token));
  // The hash lookup already matched; compare again in constant time for good measure.
  if (!key || key.revokedAt || !crypto.timingSafeEqual(Buffer.from(key.hash), Buffer.from(hashKey(token)))) return null;
  const user = await getUser(key.userId);
  if (!user) return null;
  const now = Date.now();
  if (!key.lastUsedAt || now - Date.parse(key.lastUsedAt) > TOUCH_EVERY_MS) {
    key.lastUsedAt = new Date(now).toISOString();
    await touchApiKey(key.id, key.lastUsedAt);
  }
  return { user, key };
}

/** What the browser may see about a key (never the hash). */
export function publicKey(k: ApiKey) {
  return { id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt };
}
