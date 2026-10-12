import { json, readJson, requireUser } from "@/lib/api";
import { DEFAULT_SCOPES, isScope, issueApiKey, publicKey } from "@/lib/apiKeys";
import { listApiKeys } from "@/lib/db";
import { rateLimited } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** Key management is browser-only: an API key can't list or mint keys. */
export async function GET() {
  const { user, denied } = await requireUser();
  if (denied) return denied;
  return json({ keys: (await listApiKeys(user.id)).map(publicKey) });
}

/** { name, scopes? } → the new key. `secret` is shown this one time and never stored. */
export async function POST(req: Request) {
  const { user, denied } = await requireUser();
  if (denied) return denied;
  if (rateLimited(`keys:${user.id}`, 20, 60 * 60_000)) return json({ error: "That's a lot of keys. Try again later." }, 429);
  const body = await readJson<{ name?: unknown; scopes?: unknown }>(req, 10_000);
  if (!body) return json({ error: "Bad request." }, 400);
  const name = String(body.name ?? "").trim();
  if (!name) return json({ error: "Give the key a name, like “Grok Bot”.", field: "name" }, 422);
  const raw = body.scopes === undefined ? DEFAULT_SCOPES : body.scopes;
  if (!Array.isArray(raw) || !raw.length || !raw.every((s) => typeof s === "string" && isScope(s)))
    return json({ error: "Pick at least one permission.", field: "scopes" }, 422);
  const live = (await listApiKeys(user.id)).filter((k) => !k.revokedAt).length;
  if (live >= 25) return json({ error: "You have 25 active keys. Revoke one first." }, 422);
  const { key, secret } = await issueApiKey(user.id, name, raw);
  return json({ key: publicKey(key), secret }, 201);
}
