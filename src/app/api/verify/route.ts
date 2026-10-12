import { NextResponse } from "next/server";
import { getUser, setEmailVerified } from "@/lib/db";
import { validVerification } from "@/lib/verify";

export const dynamic = "force-dynamic";

/** The link from the verification email. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await getUser(url.searchParams.get("u") ?? "");
  const ok = !!user && validVerification(user, url.searchParams.get("exp"), url.searchParams.get("sig"));
  if (ok && !user!.emailVerifiedAt) await setEmailVerified(user!.id, new Date().toISOString());
  return NextResponse.redirect(new URL(ok ? "/forms?verified=1" : "/forms?verified=0", req.url), 303);
}
