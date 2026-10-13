// Sign in with an OpenID Connect provider (authorization code flow with PKCE and a nonce, RS256 ID tokens). Shared by
// "Continue with OpenCtrl" and "Continue with Google"; each provider's settings are in src/lib/oidcProviders.ts.
// The pure parts (cookies, ID token checks, which account) are exported for tests/oidc.test.ts.
import "server-only";
import crypto from "node:crypto";
import { sign } from "./auth";

export type ProviderId = "openctrl" | "google";

/** Short tag per provider for cookie names and signatures ("oc" for OpenCtrl, kept from before Google). */
export const PROVIDER_TAG: Record<ProviderId, string> = { openctrl: "oc", google: "google" };

export interface OidcProvider {
  id: ProviderId;
  /** Shown to people: "OpenCtrl", "Google". */
  name: string;
  /** Discovery is read from `${issuer}/.well-known/openid-configuration`. */
  issuer: string;
  /** Every `iss` an ID token may carry (Google uses both "https://accounts.google.com" and "accounts.google.com"). */
  issuers: string[];
  clientId: string;
  clientSecret: string;
  scope: string;
  /** How the client authenticates at the token endpoint: client_secret_basic or client_secret_post. */
  tokenAuth: "basic" | "post";
  /** New accounts need an email the provider verified. */
  requireVerifiedEmailForNew: boolean;
  /** PROVIDER_TAG[id]. */
  tag: string;
}

export const STATE_TTL_S = 10 * 60;
export const LINK_TTL_S = 10 * 60;
const CLOCK_SKEW_S = 60;

export const stateCookieName = (p: Pick<OidcProvider, "tag">) => `clayform_${p.tag}_state`;
export const linkCookieName = (p: Pick<OidcProvider, "tag">) => `clayform_${p.tag}_link`;
export const statePurpose = (p: Pick<OidcProvider, "tag">) => `${p.tag}-state`;
export const linkPurpose = (p: Pick<OidcProvider, "tag">) => `${p.tag}-link`;

// ---- Signed cookies ------------------------------------------------------------------------------------------

/** A small JSON value signed with CLAYFORM_SECRET, with an expiry. */
export function sealCookie(purpose: string, value: Record<string, unknown>, ttlS: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...value, exp: Math.floor(now / 1000) + ttlS })).toString("base64url");
  return `${body}.${sign(`${purpose}:${body}`)}`;
}

export function openCookie<T>(purpose: string, raw: string | undefined, now = Date.now()): T | null {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(`${purpose}:${body}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    return typeof v.exp === "number" && v.exp * 1000 > now ? v : null;
  } catch {
    return null;
  }
}

export interface PendingLogin {
  state: string;
  nonce: string;
  verifier: string;
}

/** Where to send the browser, plus the cookie that remembers this attempt. */
export function startLogin(
  provider: Pick<OidcProvider, "clientId" | "scope" | "tag">,
  authorizationEndpoint: string,
  redirectUri: string,
  now = Date.now(),
) {
  const pending: PendingLogin = {
    state: crypto.randomBytes(24).toString("base64url"),
    nonce: crypto.randomBytes(24).toString("base64url"),
    verifier: crypto.randomBytes(48).toString("base64url"),
  };
  const url = new URL(authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: provider.scope,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: crypto.createHash("sha256").update(pending.verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), cookie: sealCookie(statePurpose(provider), { ...pending }, STATE_TTL_S, now), maxAge: STATE_TTL_S };
}

// ---- Discovery, keys, token exchange ---------------------------------------------------------------------------

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}
export type Jwk = { kty: string; kid?: string; n?: string; e?: string; alg?: string };

const CACHE_MS = 60 * 60 * 1000;
const discoveryCache = new Map<string, { doc: Discovery; at: number }>();
const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();

/** Forgets cached discovery documents and keys (tests). */
export function clearOidcCache() {
  discoveryCache.clear();
  jwksCache.clear();
}

export async function discover(issuer: string, fetcher: typeof fetch = fetch): Promise<Discovery> {
  const hit = discoveryCache.get(issuer);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.doc;
  const res = await fetcher(`${issuer}/.well-known/openid-configuration`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Discovery failed for ${issuer} (${res.status})`);
  const doc = (await res.json()) as Discovery;
  // The document must name the issuer we asked for (OIDC Discovery §4.3).
  if (doc.issuer !== issuer) throw new Error("Discovery returned a different issuer");
  discoveryCache.set(issuer, { doc, at: Date.now() });
  return doc;
}

async function keyFor(uri: string, kid: string, fetcher: typeof fetch): Promise<Jwk | null> {
  const hit = jwksCache.get(uri);
  const cached = hit && Date.now() - hit.at < CACHE_MS ? hit.keys.find((k) => k.kid === kid) : undefined;
  if (cached) return cached;
  // Unknown kid: the provider may have rotated keys (Google does, often), so fetch once more.
  const res = await fetcher(uri, { cache: "no-store" });
  if (!res.ok) throw new Error(`Signing keys failed (${res.status})`);
  const keys = ((await res.json()) as { keys?: Jwk[] }).keys ?? [];
  jwksCache.set(uri, { keys, at: Date.now() });
  return keys.find((k) => k.kid === kid) ?? null;
}

export interface IdClaims {
  sub: string;
  email?: string;
  /** Always a boolean here: Google has sent the string "true" in the past. */
  email_verified?: boolean;
  name?: string;
  [claim: string]: unknown;
}

/** Checks an ID token's signature and claims (OIDC Core §3.1.3.7). Throws with a reason when anything is off. */
export function verifyIdToken(
  jwt: string,
  key: Jwk | ((kid: string) => Jwk | null),
  expect: { issuer: string | string[]; clientId: string; nonce: string },
  now = Date.now(),
): IdClaims {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("ID token is malformed");
  const [h, p, s] = parts;
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { alg?: string; kid?: string };
  // Only RS256: never "none", never HMAC with the public key.
  if (header.alg !== "RS256") throw new Error("ID token uses an unexpected algorithm");
  const jwk = typeof key === "function" ? key(header.kid ?? "") : key;
  if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) throw new Error("No matching signing key");
  const publicKey = crypto.createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  if (!crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"))) throw new Error("ID token signature is invalid");
  const c = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<string, unknown>;
  const nowS = Math.floor(now / 1000);
  const issuers = Array.isArray(expect.issuer) ? expect.issuer : [expect.issuer];
  if (typeof c.iss !== "string" || !issuers.includes(c.iss)) throw new Error("ID token is from another issuer");
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(expect.clientId)) throw new Error("ID token is for another app");
  if (aud.length > 1 && c.azp !== expect.clientId) throw new Error("ID token is for another app");
  if (typeof c.exp !== "number" || c.exp + CLOCK_SKEW_S < nowS) throw new Error("ID token has expired");
  if (typeof c.iat === "number" && c.iat - CLOCK_SKEW_S > nowS) throw new Error("ID token is from the future");
  if (c.nonce !== expect.nonce) throw new Error("ID token nonce doesn't match");
  if (typeof c.sub !== "string" || !c.sub) throw new Error("ID token has no subject");
  const out: IdClaims = { ...c, sub: c.sub };
  if ("email_verified" in c) out.email_verified = c.email_verified === true || c.email_verified === "true";
  if (typeof c.email !== "string") delete out.email;
  return out;
}

/** Trades the code for tokens and returns the verified claims. */
export async function finishLogin(provider: OidcProvider, pending: PendingLogin, code: string, redirectUri: string, fetcher: typeof fetch = fetch): Promise<IdClaims> {
  const d = await discover(provider.issuer, fetcher);
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: pending.verifier });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (provider.tokenAuth === "basic") {
    headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(provider.clientId)}:${encodeURIComponent(provider.clientSecret)}`).toString("base64")}`;
  } else {
    form.set("client_id", provider.clientId);
    form.set("client_secret", provider.clientSecret);
  }
  const res = await fetcher(d.token_endpoint, { method: "POST", cache: "no-store", headers, body: form.toString() });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) throw new Error(`${provider.name} sign-in failed (${body.error ?? res.status})`);
  const header = JSON.parse(Buffer.from(body.id_token.split(".")[0] ?? "", "base64url").toString("utf8") || "{}") as { kid?: string };
  const jwk = await keyFor(d.jwks_uri, header.kid ?? "", fetcher);
  return verifyIdToken(body.id_token, () => jwk, { issuer: provider.issuers, clientId: provider.clientId, nonce: pending.nonce });
}

// ---- Which Clayform account ----------------------------------------------------------------------------------

/** `sub` is the provider account this Clayform account is already linked to, if any. */
export type Account = { id: string; emailVerifiedAt?: string | null; sub?: string | null };

export type LoginDecision =
  | { kind: "login"; userId: string }
  | { kind: "link"; userId: string }
  | { kind: "create" }
  /** An account with this email exists but we can't be sure it's the same person: ask for its password once. */
  | { kind: "confirm-password"; email: string }
  | { kind: "error"; code: "taken" | "noemail" | "unverified"; message: string };

/**
 * What to do after a provider vouches for someone. Linking by email happens only when both the provider and Clayform
 * have verified that email; otherwise someone could pre-register a victim's email in one place and take over the
 * account in the other.
 */
export function decideLogin(
  provider: Pick<OidcProvider, "name" | "requireVerifiedEmailForNew">,
  claims: Pick<IdClaims, "sub" | "email" | "email_verified">,
  bySub: Account | null,
  byEmail: Account | null,
  current: Account | null,
): LoginDecision {
  const name = provider.name;
  if (bySub) return { kind: "login", userId: bySub.id };
  if (current) {
    if (current.sub) return { kind: "error", code: "taken", message: `This Clayform account is already connected to a different ${name} account.` };
    return { kind: "link", userId: current.id };
  }
  if (!claims.email) return { kind: "error", code: "noemail", message: `${name} didn't share an email address, so we can't set up your account.` };
  if (byEmail) {
    if (byEmail.sub) return { kind: "error", code: "taken", message: `This email's Clayform account is connected to a different ${name} account.` };
    if (claims.email_verified && byEmail.emailVerifiedAt) return { kind: "link", userId: byEmail.id };
    return { kind: "confirm-password", email: claims.email };
  }
  if (provider.requireVerifiedEmailForNew && !claims.email_verified)
    return { kind: "error", code: "unverified", message: `Confirm your email with ${name} first.` };
  return { kind: "create" };
}

/** A password hash no password matches: accounts made through a provider sign in with that provider. */
export const NO_PASSWORD = "openctrl";
