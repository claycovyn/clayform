import { json, requireUser } from "@/lib/api";
import { rateLimited } from "@/lib/rateLimit";
import { siteUrl } from "@/lib/site";
import { needsEmailVerification, sendVerification } from "@/lib/verify";

export const dynamic = "force-dynamic";

/** Resend the verification email (browser session only). */
export async function POST(req: Request) {
  const { user, denied } = await requireUser();
  if (denied) return denied;
  if (!needsEmailVerification(user)) return json({ ok: true, alreadyVerified: true });
  if (rateLimited(`verify:${user.id}`, 3, 60 * 60_000)) return json({ error: "We've sent a few already. Check your spam folder, or try again in an hour." }, 429);
  return (await sendVerification(user, siteUrl(req))) ? json({ ok: true }) : json({ error: "Couldn't send the email. Try again later." }, 502);
}
