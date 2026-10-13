// "Continue with OpenCtrl": ID token checks, account linking rules, signed cookies, the token exchange against a fake
// OpenCtrl, and storage of the link, on a throwaway SQLite database.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "clayform-openctrl-"));
process.env.CLAYFORM_DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

let oc: typeof import("@/lib/openctrlLogin");
let db: typeof import("@/lib/db");
beforeAll(async () => {
  oc = await import("@/lib/openctrlLogin");
  db = await import("@/lib/db");
});
afterAll(async () => {
  await db.closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const ISS = "https://openctrl.test";
const CLIENT = "oc_clayform";
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as { n: string; e: string; kty: string }), kid: "k1", alg: "RS256" };

function jwt(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", typ: "JWT", kid: "k1" }, key = privateKey) {
  const b = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const input = `${b(header)}.${b(payload)}`;
  return `${input}.${crypto.createSign("RSA-SHA256").update(input).sign(key).toString("base64url")}`;
}
const now = Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}) => ({ iss: ISS, aud: CLIENT, sub: "user_1", iat: now, exp: now + 600, nonce: "n1", email: "ada@example.com", email_verified: true, ...over });
const expectOk = { issuer: ISS, clientId: CLIENT, nonce: "n1" };

describe("ID token", () => {
  it("accepts a token OpenCtrl signed for this app", () => {
    expect(oc.verifyIdToken(jwt(claims()), jwk, expectOk)).toMatchObject({ sub: "user_1", email: "ada@example.com" });
  });

  it("refuses anything else", () => {
    const bad: [string, string][] = [
      [jwt(claims({ iss: "https://evil.test" })), "another issuer"],
      [jwt(claims({ aud: "oc_other" })), "another app"],
      [jwt(claims({ aud: [CLIENT, "oc_other"] })), "another app"],
      [jwt(claims({ nonce: "other" })), "nonce"],
      [jwt(claims({ exp: now - 120 })), "expired"],
      [jwt(claims({ iat: now + 600 })), "future"],
      [jwt(claims(), { alg: "none", kid: "k1" }), "algorithm"],
      [jwt(claims(), { alg: "HS256", kid: "k1" }), "algorithm"],
      [jwt(claims(), undefined, crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey), "signature"],
    ];
    for (const [token, reason] of bad) expect(() => oc.verifyIdToken(token, jwk, expectOk)).toThrow(new RegExp(reason));
    const [h, , s] = jwt(claims()).split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify(claims({ sub: "admin" }))).toString("base64url")}.${s}`;
    expect(() => oc.verifyIdToken(forged, jwk, expectOk)).toThrow(/signature/);
  });
});

describe("which account", () => {
  const verified = { sub: "s1", email: "ada@example.com", email_verified: true };
  it("signs in an account already connected to this OpenCtrl account", () => {
    expect(oc.decideLogin(verified, { id: "a" }, { id: "b" }, null)).toEqual({ kind: "login", userId: "a" });
  });
  it("connects the account you're already signed in to", () => {
    expect(oc.decideLogin(verified, null, null, { id: "c" })).toEqual({ kind: "link", userId: "c" });
    expect(oc.decideLogin(verified, null, null, { id: "c", openctrlSub: "other" }).kind).toBe("error");
  });
  it("links by email only when both sides verified it; otherwise asks for the password", () => {
    expect(oc.decideLogin(verified, null, { id: "b", emailVerifiedAt: "2026-10-01T00:00:00Z" }, null)).toEqual({ kind: "link", userId: "b" });
    expect(oc.decideLogin(verified, null, { id: "b", emailVerifiedAt: null }, null)).toEqual({ kind: "confirm-password", email: "ada@example.com" });
    expect(oc.decideLogin({ ...verified, email_verified: false }, null, { id: "b", emailVerifiedAt: "2026-10-01T00:00:00Z" }, null).kind).toBe("confirm-password");
    expect(oc.decideLogin(verified, null, { id: "b", emailVerifiedAt: "x", openctrlSub: "other" }, null).kind).toBe("error");
  });
  it("creates a new account when there's none, and needs an email for it", () => {
    expect(oc.decideLogin(verified, null, null, null)).toEqual({ kind: "create" });
    expect(oc.decideLogin({ sub: "s1" }, null, null, null).kind).toBe("error");
  });
});

describe("signed cookies", () => {
  it("round-trips, and rejects tampering and expiry", () => {
    const c = oc.sealCookie("oc-state", { state: "abc" }, 600);
    expect(oc.openCookie<{ state: string }>("oc-state", c)?.state).toBe("abc");
    expect(oc.openCookie("oc-link", c)).toBeNull(); // another purpose
    const [body, sig] = c.split(".");
    const other = Buffer.from(JSON.stringify({ state: "evil", exp: now + 600 })).toString("base64url");
    expect(oc.openCookie("oc-state", `${other}.${sig}`)).toBeNull();
    expect(oc.openCookie("oc-state", `${body}.${sig}`, Date.now() + 601_000)).toBeNull();
  });
});

describe("token exchange", () => {
  it("sends the client secret and PKCE verifier, and verifies what comes back", async () => {
    const config = { issuer: ISS, clientId: CLIENT, clientSecret: "shh" };
    const start = oc.startLogin(config, `${ISS}/oauth/authorize`, "https://forms.test/api/auth/openctrl/callback");
    const authUrl = new URL(start.url);
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("scope")).toBe("openid profile email cloud");
    const pending = oc.openCookie<{ state: string; nonce: string; verifier: string }>("oc-state", start.cookie)!;
    expect(authUrl.searchParams.get("state")).toBe(pending.state);
    expect(authUrl.searchParams.get("code_challenge")).toBe(crypto.createHash("sha256").update(pending.verifier).digest("base64url"));

    const seen: { auth?: string; body?: URLSearchParams } = {};
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.endsWith("/.well-known/openid-configuration"))
        return Response.json({ issuer: ISS, authorization_endpoint: `${ISS}/oauth/authorize`, token_endpoint: `${ISS}/oauth/token`, jwks_uri: `${ISS}/oauth/jwks` });
      if (u.endsWith("/oauth/jwks")) return Response.json({ keys: [jwk] });
      if (u.endsWith("/oauth/token")) {
        seen.auth = String((init?.headers as Record<string, string>).authorization);
        seen.body = new URLSearchParams(String(init?.body));
        return Response.json({ access_token: "at", token_type: "Bearer", id_token: jwt(claims({ nonce: pending.nonce, openctrl_cloud: { plan: "free" } })) });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const got = await oc.finishLogin(config, pending, "the-code", "https://forms.test/api/auth/openctrl/callback", fake);
    expect(got).toMatchObject({ sub: "user_1", openctrl_cloud: { plan: "free" } });
    expect(seen.auth).toBe(`Basic ${Buffer.from(`${CLIENT}:shh`).toString("base64")}`);
    expect(seen.body?.get("code_verifier")).toBe(pending.verifier);
    expect(seen.body?.get("code")).toBe("the-code");
  });
});

describe("storage", () => {
  it("links one OpenCtrl account to one Clayform account", async () => {
    const t = new Date().toISOString();
    await db.createUser({ id: "ua", email: "a@example.com", name: "A", passwordHash: oc.NO_PASSWORD, passwordChangedAt: t, createdAt: t });
    await db.createUser({ id: "ub", email: "b@example.com", name: "B", passwordHash: "x", passwordChangedAt: t, createdAt: t });
    expect(await db.linkOpenctrl("ua", "sub_1")).toBe(true);
    expect((await db.getUserByOpenctrlSub("sub_1"))?.id).toBe("ua");
    expect((await db.getUser("ua"))?.openctrlSub).toBe("sub_1");
    expect(await db.linkOpenctrl("ub", "sub_1")).toBe(false);
    expect(await db.getUserByOpenctrlSub("nobody")).toBeNull();
  });

  it("accounts made through OpenCtrl have no password that works", async () => {
    const { verifyPassword } = await import("@/lib/auth");
    expect(await verifyPassword("openctrl", oc.NO_PASSWORD)).toBe(false);
    expect(await verifyPassword("", oc.NO_PASSWORD)).toBe(false);
  });
});
