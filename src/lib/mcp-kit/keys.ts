// API keys for OPENCTRL apps: "<prefix>_" + 32 random bytes (base64url). Store only the SHA-256 of the whole key and
// show the key once. Each app keeps keys in its own database; the kit only needs a lookup by hash.
import crypto from "node:crypto";

export interface ApiKeyFormat {
  /** e.g. "cf_" for Clayform. */
  prefix: string;
  pattern: RegExp;
  /** A new key: `secret` goes to the person once; store `hash` and `displayPrefix`. */
  generate(): { secret: string; hash: string; displayPrefix: string };
}

export function hashApiKey(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export function apiKeyFormat(prefix: string, bytes = 32): ApiKeyFormat {
  if (!/^[a-z][a-z0-9]{0,7}_$/.test(prefix)) throw new Error('Key prefixes look like "cf_": lowercase letters/digits and an underscore.');
  const len = Math.ceil((bytes * 4) / 3);
  return {
    prefix,
    pattern: new RegExp(`^${prefix}[A-Za-z0-9_-]{${len}}$`),
    generate() {
      const secret = prefix + crypto.randomBytes(bytes).toString("base64url");
      return { secret, hash: hashApiKey(secret), displayPrefix: secret.slice(0, prefix.length + 8) };
    },
  };
}

export interface StoredKey {
  id: string;
  hash: string;
  scopes: string[];
  revokedAt?: string | Date | null;
  lastUsedAt?: string | Date | null;
}

export interface KeyLookup<K extends StoredKey> {
  findByHash(hash: string): Promise<K | null>;
  /** Record use; called at most once per `touchEveryMs` per key. */
  touch?(id: string, at: Date): Promise<void>;
}

/** The stored key for a presented token, or null for a malformed, unknown or revoked one. */
export async function verifyApiKey<K extends StoredKey>(token: string, format: ApiKeyFormat, store: KeyLookup<K>, touchEveryMs = 60_000): Promise<K | null> {
  if (!format.pattern.test(token)) return null;
  const hash = hashApiKey(token);
  const key = await store.findByHash(hash);
  if (!key || key.revokedAt || !crypto.timingSafeEqual(Buffer.from(key.hash), Buffer.from(hash))) return null;
  const last = key.lastUsedAt ? new Date(key.lastUsedAt).getTime() : 0;
  const now = Date.now();
  if (store.touch && now - last > touchEveryMs) {
    await store.touch(key.id, new Date(now));
    key.lastUsedAt = new Date(now).toISOString();
  }
  return key;
}

/** The token from "Authorization: Bearer …": null when there's no Authorization header, "" when it's malformed. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  return m ? m[1] : "";
}
