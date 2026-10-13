// Sign-in providers (OpenCtrl and Google, src/lib/oidc.ts): ID token checks with a local test key, Google's issuer
// forms, account linking rules, signed cookies, the token exchange against a fake provider and a fake JWKS, the
// buttons on the log-in and sign-up pages, and storage of the links on a throwaway SQLite database.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "clayform-oidc-"));
process.env.CLAYFORM_DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

let oidc: typeof import("@/lib/oidc");
let providers: typeof import("@/lib/oidcProviders");
let routes: typeof import("@/lib/oidcRoutes");
let sp: typeof import("@/lib/signinProviders");
let db: typeof import("@/lib/db");
beforeAll(async () => {
  oidc = await import("@/lib/oidc");
  providers = await import("@/lib/oidcProviders");
  routes = await import("@/lib/oidcRoutes");
  sp = await import("@/lib/signinProviders");
  db = await import("@/lib/db");
});
afterAll(async () => {
  await db.closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const ISS = "https://openctrl.test";
const CLIENT = "oc_clayform";
const GOOGLE = "https://accounts.google.com";
const GOOGLE_CLIENT = "123-abc.apps.googleusercontent.com";
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
  it("accepts a token the provider signed for this app", () => {
    expect(oidc.verifyIdToken(jwt(claims()), jwk, expectOk)).toMatchObject({ sub: "user_1", email: "ada@example.com", email_verified: true });
  });

  it("refuses anything else", () => {
    const bad: [string, string][] = [
      [jwt(claims({ iss: "https://evil.test" })), "another issuer"],
      [jwt(claims({ iss: undefined })), "another issuer"],
      [jwt(claims({ aud: "oc_other" })), "another app"],
      [jwt(claims({ aud: [CLIENT, "oc_other"] })), "another app"],
      [jwt(claims({ nonce: "other" })), "nonce"],
      [jwt(claims({ exp: now - 120 })), "expired"],
      [jwt(claims({ iat: now + 600 })), "future"],
      [jwt(claims(), { alg: "none", kid: "k1" }), "algorithm"],
      [jwt(claims(), { alg: "HS256", kid: "k1" }), "algorithm"],
      [jwt(claims(), undefined, crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey), "signature"],
    ];
    for (const [token, reason] of bad) expect(() => oidc.verifyIdToken(token, jwk, expectOk)).toThrow(new RegExp(reason));
    const [h, , s] = jwt(claims()).split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify(claims({ sub: "admin" }))).toString("base64url")}.${s}`;
    expect(() => oidc.verifyIdToken(forged, jwk, expectOk)).toThrow(/signature/);
  });

  it("accepts both of Google's issuer forms and nothing near them", () => {
    const google = { issuer: [GOOGLE, "accounts.google.com"], clientId: GOOGLE_CLIENT, nonce: "n1" };
    for (const iss of [GOOGLE, "accounts.google.com"]) expect(oidc.verifyIdToken(jwt(claims({ iss, aud: GOOGLE_CLIENT })), jwk, google).sub).toBe("user_1");
    for (const iss of ["http://accounts.google.com", "https://accounts.google.com/", "https://accounts.google.com.evil.test", "accounts.google.co"])
      expect(() => oidc.verifyIdToken(jwt(claims({ iss, aud: GOOGLE_CLIENT })), jwk, google)).toThrow(/another issuer/);
  });

  it("reads email_verified as a boolean (Google once sent the string)", () => {
    expect(oidc.verifyIdToken(jwt(claims({ email_verified: "true" })), jwk, expectOk).email_verified).toBe(true);
    expect(oidc.verifyIdToken(jwt(claims({ email_verified: "false" })), jwk, expectOk).email_verified).toBe(false);
    expect(oidc.verifyIdToken(jwt(claims({ email_verified: 1 })), jwk, expectOk).email_verified).toBe(false);
    expect(oidc.verifyIdToken(jwt(claims({ email: 42 })), jwk, expectOk).email).toBeUndefined();
  });
});

describe("providers", () => {
  it("are off until both the client ID and secret are set", () => {
    expect(providers.providerConfig("google", {})).toBeNull();
    expect(providers.providerConfig("google", { GOOGLE_CLIENT_ID: "x" })).toBeNull();
    expect(providers.providerConfig("google", { GOOGLE_CLIENT_SECRET: "y" })).toBeNull();
    expect(providers.providerConfig("openctrl", { OPENCTRL_CLIENT_ID: "x" })).toBeNull();
  });

  it("Google: discovery at accounts.google.com, both issuer forms, client_secret_post, verified email for new accounts", () => {
    expect(providers.providerConfig("google", { GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y" })).toMatchObject({
      issuer: GOOGLE,
      issuers: [GOOGLE, "accounts.google.com"],
      scope: "openid email profile",
      tokenAuth: "post",
      requireVerifiedEmailForNew: true,
    });
  });

  it("OpenCtrl: as before (issuer override, basic auth, cloud scope, cookie names)", () => {
    const oc = providers.providerConfig("openctrl", { OPENCTRL_CLIENT_ID: "x", OPENCTRL_CLIENT_SECRET: "y", OPENCTRL_ISSUER: "https://oc.test/" })!;
    expect(oc).toMatchObject({ issuer: "https://oc.test", issuers: ["https://oc.test"], tokenAuth: "basic", scope: "openid profile email cloud" });
    expect([oidc.stateCookieName(oc), oidc.linkCookieName(oc), oidc.statePurpose(oc)]).toEqual(["clayform_oc_state", "clayform_oc_link", "oc-state"]);
    expect(providers.providerConfig("openctrl", { OPENCTRL_CLIENT_ID: "x", OPENCTRL_CLIENT_SECRET: "y" })!.issuer).toBe("https://openctrl.app");
  });
});

describe("which account", () => {
  const openctrl = { name: "OpenCtrl", requireVerifiedEmailForNew: false };
  const google = { name: "Google", requireVerifiedEmailForNew: true };
  const verified = { sub: "s1", email: "ada@example.com", email_verified: true };

  for (const p of [openctrl, google]) {
    describe(p.name, () => {
      it("signs in an account already connected to this provider account", () => {
        expect(oidc.decideLogin(p, verified, { id: "a" }, { id: "b" }, null)).toEqual({ kind: "login", userId: "a" });
      });
      it("connects the account you're already signed in to", () => {
        expect(oidc.decideLogin(p, verified, null, null, { id: "c" })).toEqual({ kind: "link", userId: "c" });
        expect(oidc.decideLogin(p, verified, null, null, { id: "c", sub: "other" })).toMatchObject({ kind: "error", code: "taken" });
      });
      it("links by email only when both sides verified it; otherwise asks for the password", () => {
        expect(oidc.decideLogin(p, verified, null, { id: "b", emailVerifiedAt: "2026-10-01T00:00:00Z" }, null)).toEqual({ kind: "link", userId: "b" });
        expect(oidc.decideLogin(p, verified, null, { id: "b", emailVerifiedAt: null }, null)).toEqual({ kind: "confirm-password", email: "ada@example.com" });
        expect(oidc.decideLogin(p, { ...verified, email_verified: false }, null, { id: "b", emailVerifiedAt: "2026-10-01T00:00:00Z" }, null).kind).toBe("confirm-password");
        expect(oidc.decideLogin(p, verified, null, { id: "b", emailVerifiedAt: "x", sub: "other" }, null)).toMatchObject({ kind: "error", code: "taken" });
      });
      it("creates a new account when there's none, and needs an email for it", () => {
        expect(oidc.decideLogin(p, verified, null, null, null)).toEqual({ kind: "create" });
        expect(oidc.decideLogin(p, { sub: "s1" }, null, null, null)).toMatchObject({ kind: "error", code: "noemail" });
      });
    });
  }

  it("Google needs a verified email for a new account; OpenCtrl keeps its old rule", () => {
    const unverified = { ...verified, email_verified: false };
    expect(oidc.decideLogin(google, unverified, null, null, null)).toMatchObject({ kind: "error", code: "unverified" });
    expect(oidc.decideLogin(google, { sub: "s1", email: "ada@example.com" }, null, null, null)).toMatchObject({ kind: "error", code: "unverified" });
    expect(oidc.decideLogin(openctrl, unverified, null, null, null)).toEqual({ kind: "create" });
  });
});

describe("signed cookies", () => {
  it("round-trips, and rejects tampering, another purpose and expiry", () => {
    const c = oidc.sealCookie("oc-state", { state: "abc" }, 600);
    expect(oidc.openCookie<{ state: string }>("oc-state", c)?.state).toBe("abc");
    expect(oidc.openCookie("oc-link", c)).toBeNull();
    expect(oidc.openCookie("google-state", c)).toBeNull(); // another provider
    const [body, sig] = c.split(".");
    const other = Buffer.from(JSON.stringify({ state: "evil", exp: now + 600 })).toString("base64url");
    expect(oidc.openCookie("oc-state", `${other}.${sig}`)).toBeNull();
    expect(oidc.openCookie("oc-state", `${body}.${sig}`, Date.now() + 601_000)).toBeNull();
  });
});

/** A fake provider: discovery, a JWKS (with another key beside the right one) and a token endpoint that records what it got. */
function fakeProvider(iss: string, idClaims: (nonce: string) => Record<string, unknown>, kid = "k1", keys?: object[]) {
  const seen: { auth?: string; body?: URLSearchParams } = {};
  let nonce = "";
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    if (u === `${iss}/.well-known/openid-configuration`)
      return Response.json({ issuer: iss, authorization_endpoint: `${iss}/o/auth`, token_endpoint: `${iss}/o/token`, jwks_uri: `${iss}/o/certs` });
    if (u === `${iss}/o/certs`) {
      const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
      return Response.json({ keys: keys ?? [{ ...other, kid: "old", alg: "RS256" }, { ...jwk, kid }] });
    }
    if (u === `${iss}/o/token`) {
      seen.auth = (init?.headers as Record<string, string>).authorization;
      seen.body = new URLSearchParams(String(init?.body));
      return Response.json({ access_token: "at", token_type: "Bearer", id_token: jwt(idClaims(nonce), { alg: "RS256", typ: "JWT", kid }) });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { seen, fetcher, setNonce: (n: string) => (nonce = n) };
}

describe("token exchange", () => {
  beforeEach(() => oidc.clearOidcCache());

  it("OpenCtrl: client_secret_basic and the PKCE verifier, and verifies what comes back", async () => {
    const config = providers.providerConfig("openctrl", { OPENCTRL_CLIENT_ID: CLIENT, OPENCTRL_CLIENT_SECRET: "shh", OPENCTRL_ISSUER: ISS })!;
    const start = oidc.startLogin(config, `${ISS}/o/auth`, "https://forms.test/api/auth/openctrl/callback");
    const authUrl = new URL(start.url);
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("scope")).toBe("openid profile email cloud");
    const pending = oidc.openCookie<{ state: string; nonce: string; verifier: string }>("oc-state", start.cookie)!;
    expect(authUrl.searchParams.get("state")).toBe(pending.state);
    expect(authUrl.searchParams.get("nonce")).toBe(pending.nonce);
    expect(authUrl.searchParams.get("code_challenge")).toBe(crypto.createHash("sha256").update(pending.verifier).digest("base64url"));

    const fake = fakeProvider(ISS, (nonce) => claims({ nonce, openctrl_cloud: { plan: "free" } }));
    fake.setNonce(pending.nonce);
    const got = await oidc.finishLogin(config, pending, "the-code", "https://forms.test/api/auth/openctrl/callback", fake.fetcher);
    expect(got).toMatchObject({ sub: "user_1", openctrl_cloud: { plan: "free" } });
    expect(fake.seen.auth).toBe(`Basic ${Buffer.from(`${CLIENT}:shh`).toString("base64")}`);
    expect(fake.seen.body?.get("client_secret")).toBeNull();
    expect(fake.seen.body?.get("code_verifier")).toBe(pending.verifier);
    expect(fake.seen.body?.get("code")).toBe("the-code");
  });

  it("Google: client_secret_post, the short issuer form, the key picked from the JWKS by kid", async () => {
    const google = providers.providerConfig("google", { GOOGLE_CLIENT_ID: GOOGLE_CLIENT, GOOGLE_CLIENT_SECRET: "gshh" })!;
    const start = oidc.startLogin(google, `${GOOGLE}/o/auth`, "https://forms.test/api/auth/google/callback");
    expect(new URL(start.url).searchParams.get("scope")).toBe("openid email profile");
    expect(oidc.openCookie("oc-state", start.cookie)).toBeNull();
    const pending = oidc.openCookie<{ state: string; nonce: string; verifier: string }>("google-state", start.cookie)!;

    const fake = fakeProvider(GOOGLE, (nonce) => claims({ iss: "accounts.google.com", aud: GOOGLE_CLIENT, nonce, email_verified: "true" }), "g1");
    fake.setNonce(pending.nonce);
    const got = await oidc.finishLogin(google, pending, "g-code", "https://forms.test/api/auth/google/callback", fake.fetcher);
    expect(got).toMatchObject({ sub: "user_1", email: "ada@example.com", email_verified: true });
    expect(fake.seen.auth).toBeUndefined();
    expect(fake.seen.body?.get("client_id")).toBe(GOOGLE_CLIENT);
    expect(fake.seen.body?.get("client_secret")).toBe("gshh");
    expect(fake.seen.body?.get("code_verifier")).toBe(pending.verifier);
    expect(fake.seen.body?.get("redirect_uri")).toBe("https://forms.test/api/auth/google/callback");
  });

  it("refuses a token for another client, with a wrong nonce or issuer, or signed by a key not in the JWKS", async () => {
    const google = providers.providerConfig("google", { GOOGLE_CLIENT_ID: GOOGLE_CLIENT, GOOGLE_CLIENT_SECRET: "gshh" })!;
    const pending = { state: "s", nonce: "right", verifier: "v" };
    const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
    const cases: [ReturnType<typeof fakeProvider>, RegExp][] = [
      [fakeProvider(GOOGLE, () => claims({ iss: GOOGLE, aud: "someone-else", nonce: "right" })), /another app/],
      [fakeProvider(GOOGLE, () => claims({ iss: GOOGLE, aud: GOOGLE_CLIENT, nonce: "wrong" })), /nonce/],
      [fakeProvider(GOOGLE, () => claims({ iss: "https://evil.test", aud: GOOGLE_CLIENT, nonce: "right" })), /another issuer/],
      // The JWKS has no key with the token's kid (refetched once in case of rotation, then refused).
      [fakeProvider(GOOGLE, () => claims({ iss: GOOGLE, aud: GOOGLE_CLIENT, nonce: "right" }), "g1", [{ ...jwk, kid: "other" }]), /No matching signing key/],
      // A key under the right kid that didn't sign it.
      [fakeProvider(GOOGLE, () => claims({ iss: GOOGLE, aud: GOOGLE_CLIENT, nonce: "right" }), "g1", [{ ...other, kid: "g1" }]), /signature/],
    ];
    for (const [fake, why] of cases) {
      oidc.clearOidcCache();
      await expect(oidc.finishLogin(google, pending, "c", "https://forms.test/cb", fake.fetcher)).rejects.toThrow(why);
    }
  });

  it("refuses a discovery document that names another issuer", async () => {
    const fetcher = (async () => Response.json({ issuer: "https://evil.test", authorization_endpoint: "", token_endpoint: "", jwks_uri: "" })) as unknown as typeof fetch;
    await expect(oidc.discover(GOOGLE, fetcher)).rejects.toThrow(/different issuer/);
  });
});

describe("log-in and sign-up buttons", () => {
  it("shows nothing with neither provider set up, so the page is just the email form", () => {
    expect(sp.providerView({ openctrl: false, google: false })).toEqual({ buttons: [], divider: false, notices: [] });
  });
  it("puts OpenCtrl above Google, then one divider", () => {
    const v = sp.providerView({ google: true, openctrl: true });
    expect(v.buttons.map((p) => sp.PROVIDER_LABEL[p])).toEqual(["Continue with OpenCtrl", "Continue with Google"]);
    expect(v.divider).toBe(true);
  });
  it("shows each provider only when it's set up", () => {
    expect(sp.providerView({ openctrl: true }).buttons).toEqual(["openctrl"]);
    expect(sp.providerView({ google: true }).buttons).toEqual(["google"]);
  });
  it("steps the buttons aside while a link waits for the password", () => {
    for (const p of ["openctrl", "google"] as const) {
      const v = sp.providerView({ openctrl: true, google: true }, { [p]: "link" });
      expect(v).toMatchObject({ buttons: [], divider: false });
      expect(v.notices[0]).toMatchObject({ role: "status" });
    }
  });
  it("names the provider in its messages, and ignores codes it doesn't know", () => {
    expect(sp.providerView({}, { google: "cancelled" }).notices).toEqual([{ role: "alert", text: "Sign-in with Google was cancelled." }]);
    expect(sp.providerView({}, { google: "unverified" }).notices[0].text).toMatch(/Confirm your email with Google/);
    expect(sp.providerView({}, { openctrl: "taken" }).notices[0].text).toMatch(/That OpenCtrl account/);
    expect(sp.providerView({ google: true }, { google: "constructor", openctrl: "<b>" }).notices).toEqual([]);
  });
  it("start and callback routes", () => {
    expect(sp.startHref("google")).toBe("/api/auth/google/start");
    expect(sp.callbackPath("google")).toBe("/api/auth/google/callback");
    expect(sp.callbackPath("openctrl")).toBe("/api/auth/openctrl/callback");
  });
});

describe("storage", () => {
  it("links one provider account to one Clayform account, per provider", async () => {
    const t = new Date().toISOString();
    await db.createUser({ id: "ua", email: "a@example.com", name: "A", passwordHash: oidc.NO_PASSWORD, passwordChangedAt: t, createdAt: t });
    await db.createUser({ id: "ub", email: "b@example.com", name: "B", passwordHash: "x", passwordChangedAt: t, createdAt: t });
    expect(await db.linkProvider("openctrl", "ua", "sub_1")).toBe(true);
    expect((await db.getUserByProviderSub("openctrl", "sub_1"))?.id).toBe("ua");
    expect((await db.getUser("ua"))?.openctrlSub).toBe("sub_1");
    expect(await db.linkProvider("openctrl", "ub", "sub_1")).toBe(false);
    expect(await db.getUserByProviderSub("openctrl", "nobody")).toBeNull();

    // google_sub is its own unique column.
    expect(await db.getUserByProviderSub("google", "sub_1")).toBeNull();
    expect(await db.linkProvider("google", "ub", "sub_1")).toBe(true);
    expect(await db.linkProvider("google", "ua", "sub_1")).toBe(false);
    const b = (await db.getUser("ub"))!;
    expect([b.googleSub, b.openctrlSub]).toEqual(["sub_1", null]);
    expect(db.providerSubOf(b, "google")).toBe("sub_1");
    expect(db.providerSubOf(b, "openctrl")).toBeNull();
  });

  it("finishes a pending link after a password log-in, only for the same email and the right signature", async () => {
    const t = new Date().toISOString();
    await db.createUser({ id: "uc", email: "c@example.com", name: "C", passwordHash: "x", passwordChangedAt: t, createdAt: t });
    const jarWith = (cookies: Record<string, string>) => {
      const deleted: string[] = [];
      return { deleted, get: (n: string) => (cookies[n] ? { value: cookies[n] } : undefined), delete: (n: string) => deleted.push(n) };
    };
    const user = async () => (await db.getUser("uc"))!;
    const otherEmail = jarWith({ clayform_google_link: oidc.sealCookie("google-link", { sub: "g_c", email: "someone@example.com" }, 600) });
    expect(await routes.finishPendingLinks(await user(), otherEmail)).toBe(false);
    expect(otherEmail.deleted).toEqual(["clayform_google_link"]);
    // An OpenCtrl-purpose cookie under Google's name doesn't count.
    const crossed = jarWith({ clayform_google_link: oidc.sealCookie("oc-link", { sub: "g_c", email: "c@example.com" }, 600) });
    expect(await routes.finishPendingLinks(await user(), crossed)).toBe(false);
    const jar = jarWith({ clayform_google_link: oidc.sealCookie("google-link", { sub: "g_c", email: "c@example.com" }, 600) });
    expect(await routes.finishPendingLinks(await user(), jar)).toBe(true);
    expect((await db.getUserByProviderSub("google", "g_c"))?.id).toBe("uc");
    // Already linked to Google: a second pending link is ignored.
    const again = jarWith({ clayform_google_link: oidc.sealCookie("google-link", { sub: "g_other", email: "c@example.com" }, 600) });
    expect(await routes.finishPendingLinks(await user(), again)).toBe(false);
  });

  it("accounts made through a provider have no password that works", async () => {
    const { verifyPassword } = await import("@/lib/auth");
    expect(await verifyPassword("openctrl", oidc.NO_PASSWORD)).toBe(false);
    expect(await verifyPassword("", oidc.NO_PASSWORD)).toBe(false);
  });
});
