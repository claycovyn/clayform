import { NextResponse } from "next/server";
import { discover, openctrlConfig, startLogin, STATE_COOKIE } from "@/lib/openctrlLogin";
import { clientIp, rateLimited } from "@/lib/rateLimit";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

/** "Continue with OpenCtrl": remembers this attempt in a signed cookie and sends the browser to OpenCtrl. */
export async function GET(req: Request) {
  const config = openctrlConfig();
  const back = (code: string) => NextResponse.redirect(new URL(`/login?openctrl=${code}`, siteUrl(req)), 303);
  if (!config) return back("off");
  if (rateLimited(`openctrl-start:${clientIp(req)}`, 30)) return back("busy");
  let authorizationEndpoint: string;
  try {
    authorizationEndpoint = (await discover(config.issuer)).authorization_endpoint;
  } catch (e) {
    console.error("[openctrl] discovery:", e instanceof Error ? e.message : e);
    return back("failed");
  }
  const start = startLogin(config, authorizationEndpoint, `${siteUrl(req)}/api/auth/openctrl/callback`);
  const res = NextResponse.redirect(start.url, 303);
  res.cookies.set(STATE_COOKIE, start.cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/openctrl",
    maxAge: start.maxAge,
  });
  return res;
}
