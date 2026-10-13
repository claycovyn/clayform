// The start and callback routes for every sign-in provider (/api/auth/<provider>/{start,callback}).
import "server-only";
import { NextResponse } from "next/server";
import { currentUser, normalizeEmail, signupsOpen, startSession } from "./auth";
import { claimOrphanForms, createUser, getUser, getUserByEmail, getUserByProviderSub, linkProvider, providerSubOf, setEmailVerified, type User } from "./db";
import { uid } from "./fields";
import {
  decideLogin,
  discover,
  finishLogin,
  LINK_TTL_S,
  linkCookieName,
  linkPurpose,
  NO_PASSWORD,
  openCookie,
  PROVIDER_TAG,
  sealCookie,
  startLogin,
  stateCookieName,
  statePurpose,
  type Account,
  type OidcProvider,
  type PendingLogin,
  type ProviderId,
} from "./oidc";
import { providerConfig } from "./oidcProviders";
import { newUserPlan } from "./plans";
import { clientIp, rateLimited } from "./rateLimit";
import { callbackPath } from "./signinProviders";
import { siteUrl } from "./site";

const cookieOf = (req: Request, name: string) =>
  req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

const cookiePath = (id: ProviderId) => `/api/auth/${id}`;
const loginWith = (id: ProviderId, code: string) => `/login?${id}=${code}`;

/** Remembers this attempt in a signed cookie and sends the browser to the provider. */
export async function oidcStart(req: Request, id: ProviderId): Promise<Response> {
  const provider = providerConfig(id);
  const back = (code: string) => NextResponse.redirect(new URL(loginWith(id, code), siteUrl(req)), 303);
  if (!provider) return back("off");
  if (rateLimited(`${id}-start:${clientIp(req)}`, 30)) return back("busy");
  let authorizationEndpoint: string;
  try {
    authorizationEndpoint = (await discover(provider.issuer)).authorization_endpoint;
  } catch (e) {
    console.error(`[${id}] discovery:`, e instanceof Error ? e.message : e);
    return back("failed");
  }
  const start = startLogin(provider, authorizationEndpoint, `${siteUrl(req)}${callbackPath(id)}`);
  const res = NextResponse.redirect(start.url, 303);
  res.cookies.set(stateCookieName(provider), start.cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: cookiePath(id),
    maxAge: start.maxAge,
  });
  return res;
}

const asAccount = (u: User | null, id: ProviderId): Account | null => (u ? { id: u.id, emailVerifiedAt: u.emailVerifiedAt, sub: providerSubOf(u, id) } : null);

/** The provider sent the browser back: check everything, then log in, link, create, or ask for the password. */
export async function oidcCallback(req: Request, id: ProviderId): Promise<Response> {
  const url = new URL(req.url);
  const provider = providerConfig(id);
  const go = (path: string, p: OidcProvider | null = provider) => {
    const res = NextResponse.redirect(new URL(path, siteUrl(req)), 303);
    if (p) res.cookies.set(stateCookieName(p), "", { path: cookiePath(id), maxAge: 0 });
    return res;
  };
  const back = (code: string) => go(loginWith(id, code));

  if (!provider) return back("off");
  const pending = openCookie<PendingLogin>(statePurpose(provider), cookieOf(req, stateCookieName(provider)));
  // No cookie or a different state: this callback didn't start here (or took over 10 minutes). Never continue.
  if (!pending || url.searchParams.get("state") !== pending.state) return back("expired");
  const error = url.searchParams.get("error");
  if (error) return back(error === "access_denied" ? "cancelled" : "failed");
  // RFC 9207: when the response names its issuer, it must be ours.
  const iss = url.searchParams.get("iss");
  if (iss && !provider.issuers.includes(iss)) return back("failed");
  const code = url.searchParams.get("code");
  if (!code) return back("failed");

  let claims;
  try {
    claims = await finishLogin(provider, pending, code, `${siteUrl(req)}${callbackPath(id)}`);
  } catch (e) {
    console.error(`[${id}] sign-in:`, e instanceof Error ? e.message : e);
    return back("failed");
  }

  const email = claims.email ? normalizeEmail(claims.email) : null;
  const [bySub, byEmail, current] = await Promise.all([getUserByProviderSub(id, claims.sub), email ? getUserByEmail(email) : null, currentUser()]);
  const decision = decideLogin(provider, { ...claims, email: email ?? undefined }, asAccount(bySub, id), asAccount(byEmail, id), asAccount(current, id));
  const now = new Date().toISOString();

  switch (decision.kind) {
    case "login": {
      await startSession(bySub!);
      return go("/forms");
    }
    case "link": {
      if (!(await linkProvider(id, decision.userId, claims.sub))) return back("taken");
      const user = (await getUser(decision.userId))!;
      // The provider confirmed this same address: count it as confirmed here too.
      if (claims.email_verified && email === user.email && !user.emailVerifiedAt) await setEmailVerified(user.id, now);
      await startSession(user);
      return go(current ? `/account?${id}=linked` : "/forms");
    }
    case "create": {
      if (!signupsOpen()) return back("closed");
      const user = {
        id: uid(16),
        email: email!,
        name: (claims.name ?? "").trim().slice(0, 80) || email!.split("@")[0],
        passwordHash: NO_PASSWORD,
        passwordChangedAt: now,
        createdAt: now,
        plan: newUserPlan(),
      };
      if (!(await createUser(user))) return back("failed");
      await linkProvider(id, user.id, claims.sub);
      if (claims.email_verified) await setEmailVerified(user.id, now);
      await claimOrphanForms(user.id);
      await startSession(user);
      return go("/forms");
    }
    case "confirm-password": {
      // Remember who the provider vouched for; logging in with this account's password links them (api/login).
      const res = back("link");
      res.cookies.set(linkCookieName(provider), sealCookie(linkPurpose(provider), { sub: claims.sub, email: decision.email }, LINK_TTL_S), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: LINK_TTL_S,
      });
      return res;
    }
    default:
      return back(decision.code);
  }
}

/**
 * After a password log-in: if a provider sign-in was waiting on this account's password (the link cookie), connect
 * the two now. The cookie is signed with CLAYFORM_SECRET, so it needs no provider settings. True when one was linked.
 */
export async function finishPendingLinks(user: User, jar: { get(name: string): { value: string } | undefined; delete(name: string): unknown }): Promise<boolean> {
  let linked = false;
  for (const id of Object.keys(PROVIDER_TAG) as ProviderId[]) {
    const tags = { tag: PROVIDER_TAG[id] };
    const raw = jar.get(linkCookieName(tags))?.value;
    if (!raw) continue;
    jar.delete(linkCookieName(tags));
    const pending = openCookie<{ sub: string; email: string }>(linkPurpose(tags), raw);
    if (pending && pending.email === user.email && !providerSubOf(user, id) && (await linkProvider(id, user.id, pending.sub))) linked = true;
  }
  return linked;
}
