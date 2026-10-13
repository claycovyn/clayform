import { NextResponse } from "next/server";
import { currentUser, normalizeEmail, signupsOpen, startSession } from "@/lib/auth";
import { claimOrphanForms, createUser, getUser, getUserByEmail, getUserByOpenctrlSub, linkOpenctrl, setEmailVerified } from "@/lib/db";
import { uid } from "@/lib/fields";
import {
  decideLogin,
  finishLogin,
  LINK_COOKIE,
  NO_PASSWORD,
  openCookie,
  openctrlConfig,
  sealCookie,
  STATE_COOKIE,
  type PendingLogin,
} from "@/lib/openctrlLogin";
import { newUserPlan } from "@/lib/plans";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const cookieOf = (req: Request, name: string) =>
  req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const go = (path: string) => {
    const res = NextResponse.redirect(new URL(path, siteUrl(req)), 303);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/auth/openctrl", maxAge: 0 });
    return res;
  };
  const back = (code: string) => go(`/login?openctrl=${code}`);

  const config = openctrlConfig();
  if (!config) return back("off");
  const pending = openCookie<PendingLogin>("oc-state", cookieOf(req, STATE_COOKIE));
  // No cookie or a different state: this callback didn't start here (or took over 10 minutes). Never continue.
  if (!pending || url.searchParams.get("state") !== pending.state) return back("expired");
  const error = url.searchParams.get("error");
  if (error) return back(error === "access_denied" ? "cancelled" : "failed");
  // RFC 9207: the response must say it came from our issuer.
  const iss = url.searchParams.get("iss");
  if (iss && iss !== config.issuer) return back("failed");
  const code = url.searchParams.get("code");
  if (!code) return back("failed");

  let claims;
  try {
    claims = await finishLogin(config, pending, code, `${siteUrl(req)}/api/auth/openctrl/callback`);
  } catch (e) {
    console.error("[openctrl] sign-in:", e instanceof Error ? e.message : e);
    return back("failed");
  }

  const email = claims.email ? normalizeEmail(claims.email) : null;
  const [bySub, byEmail, current] = await Promise.all([getUserByOpenctrlSub(claims.sub), email ? getUserByEmail(email) : null, currentUser()]);
  const decision = decideLogin({ ...claims, email: email ?? undefined }, bySub, byEmail, current);
  const now = new Date().toISOString();

  switch (decision.kind) {
    case "login": {
      await startSession(bySub!);
      return go("/forms");
    }
    case "link": {
      if (!(await linkOpenctrl(decision.userId, claims.sub))) return back("taken");
      const user = (await getUser(decision.userId))!;
      // OpenCtrl confirmed this same address: count it as confirmed here too.
      if (claims.email_verified && email === user.email && !user.emailVerifiedAt) await setEmailVerified(user.id, now);
      await startSession(user);
      return go(current ? "/account?openctrl=linked" : "/forms");
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
      await linkOpenctrl(user.id, claims.sub);
      if (claims.email_verified) await setEmailVerified(user.id, now);
      await claimOrphanForms(user.id);
      await startSession(user);
      return go("/forms");
    }
    case "confirm-password": {
      // Remember who OpenCtrl vouched for; logging in with this account's password links them (api/login).
      const res = back("link");
      res.cookies.set(LINK_COOKIE, sealCookie("oc-link", { sub: claims.sub, email: decision.email }, 10 * 60), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 10 * 60,
      });
      return res;
    }
    default:
      return back(email ? "taken" : "noemail");
  }
}
