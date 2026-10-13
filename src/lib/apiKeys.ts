// API keys let AI agents and scripts use Clayform on someone's behalf (REST API and the MCP server).
// Format: "cf_" + 32 random bytes (base64url). Only the SHA-256 of the whole key is stored; the key is shown once.
import "server-only";
import { apiKeyFormat, bearerToken, hashApiKey, verifyApiKey as verifyKey } from "./mcp-kit";
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

/** Clayform keys: "cf_" + 32 random bytes (base64url), via the shared OpenCtrl kit. */
export const KEY_FORMAT = apiKeyFormat("cf_");
export const KEY_PREFIX = KEY_FORMAT.prefix;

export function isScope(s: string): s is Scope {
  return s in SCOPES;
}

export const hashKey = hashApiKey;
export { bearerToken };

/** Creates a key for the user. The returned `secret` is the only time the full key exists outside the caller. */
export async function issueApiKey(userId: string, name: string, scopes: Scope[]): Promise<{ key: ApiKey; secret: string }> {
  const { secret, hash, displayPrefix } = KEY_FORMAT.generate();
  const key: ApiKey = {
    id: uid(),
    userId,
    name: name.trim().slice(0, 80) || "API key",
    prefix: displayPrefix,
    hash,
    scopes: [...new Set(scopes)],
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };
  await createApiKey(key);
  return { key, secret };
}

/** The key's owner and scopes, or null for a malformed, unknown or revoked key. Records last use (at most once a minute). */
export async function verifyApiKey(token: string): Promise<{ user: User; key: ApiKey } | null> {
  const key = await verifyKey(token, KEY_FORMAT, { findByHash: getApiKeyByHash, touch: (id, at) => touchApiKey(id, at.toISOString()) });
  const user = key ? await getUser(key.userId) : null;
  return key && user ? { user, key } : null;
}

/** What the browser may see about a key (never the hash). */
export function publicKey(k: ApiKey) {
  return { id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt };
}
