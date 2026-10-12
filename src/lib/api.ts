import "server-only";
import { NextResponse } from "next/server";
import { ALL_SCOPES, bearerToken, verifyApiKey, type Scope } from "./apiKeys";
import { currentUser } from "./auth";
import { getOwnedForm, type User } from "./db";
import { meter } from "./plans";
import { rateLimited } from "./rateLimit";
import type { Form } from "./types";

/** Requests per minute allowed for one API key. */
export const KEY_RATE_LIMIT = 120;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** Who is calling: a browser session (every permission) or an API key (its scopes). */
export interface Caller {
  user: User;
  via: "cookie" | "key";
  scopes: Scope[];
  keyId?: string;
}

type Gate<T> = ({ denied: null } & T) | ({ denied: NextResponse } & { [K in keyof T]: null });

/**
 * The caller, or a response to return. Pass the request to also accept "Authorization: Bearer cf_…" keys;
 * without it only the session cookie counts (account settings and key management stay browser-only).
 */
export async function authenticate(req?: Request): Promise<{ caller: Caller; denied: null } | { caller: null; denied: NextResponse }> {
  const token = req ? bearerToken(req) : null;
  if (token !== null) {
    const found = token ? await verifyApiKey(token) : null;
    if (!found) return { caller: null, denied: json({ error: "Invalid or revoked API key." }, 401, { "www-authenticate": 'Bearer realm="clayform"' }) };
    if (rateLimited(`key:${found.key.id}`, KEY_RATE_LIMIT))
      return { caller: null, denied: json({ error: "Too many requests for this API key. Try again in a minute." }, 429, { "retry-after": "60" }) };
    await meter(found.user.id, "api_requests");
    return { caller: { user: found.user, via: "key", scopes: found.key.scopes.filter((s): s is Scope => ALL_SCOPES.includes(s as Scope)), keyId: found.key.id }, denied: null };
  }
  const user = await currentUser();
  return user ? { caller: { user, via: "cookie", scopes: [...ALL_SCOPES] }, denied: null } : { caller: null, denied: json({ error: "Sign in first." }, 401) };
}

export function missingScope(caller: Caller, scope: Scope): NextResponse | null {
  return caller.scopes.includes(scope) ? null : json({ error: `This API key doesn't have the "${scope}" permission.` }, 403);
}

/** The signed-in user (or, with a request and scope, an API key holding that scope), or a response to return. */
export async function requireUser(req?: Request, scope?: Scope): Promise<Gate<{ user: User; caller: Caller }>> {
  const { caller, denied } = await authenticate(req);
  if (denied) return { user: null, caller: null, denied };
  const forbidden = scope ? missingScope(caller, scope) : null;
  if (forbidden) return { user: null, caller: null, denied: forbidden };
  return { user: caller.user, caller, denied: null };
}

/** A form the caller owns, or a response to return (401 signed out, 403 missing scope, 404 not theirs or missing). */
export async function requireOwnedForm(id: string, req?: Request, scope?: Scope): Promise<Gate<{ user: User; form: Form; caller: Caller }>> {
  const { user, caller, denied } = await requireUser(req, scope);
  if (denied) return { user: null, form: null, caller: null, denied };
  const form = await getOwnedForm(id, user.id);
  return form ? { user, form, caller, denied: null } : { user: null, form: null, caller: null, denied: json({ error: "Not found." }, 404) };
}

/** Read a JSON body with a size cap. */
export async function readJson<T>(req: Request, maxBytes = 1_000_000): Promise<T | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
