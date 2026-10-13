import { cookies } from "next/headers";
import { authProblem, normalizeEmail, startSession, verifyNothing, verifyPassword } from "@/lib/auth";
import { json, readJson } from "@/lib/api";
import { getUserByEmail, linkOpenctrl, storageProblem } from "@/lib/db";
import { LINK_COOKIE, openCookie } from "@/lib/openctrlLogin";
import { clientIp, rateLimited } from "@/lib/rateLimit";

export async function POST(req: Request) {
  const problem = storageProblem() ?? authProblem();
  if (problem) return json({ error: problem }, 503);
  const body = await readJson<{ email?: string; password?: string }>(req, 10_000);
  const email = normalizeEmail(String(body?.email ?? ""));
  const password = String(body?.password ?? "");
  // Per address and per IP, so one account can't be brute-forced from many places or many from one.
  if (rateLimited(`login:${clientIp(req)}`, 20) || rateLimited(`login:${email}`, 10, 15 * 60_000))
    return json({ error: "Too many tries. Wait a few minutes." }, 429);

  const user = email ? await getUserByEmail(email) : null;
  if (!user) {
    await verifyNothing(password);
    return json({ error: "Wrong email or password." }, 401);
  }
  if (!(await verifyPassword(password, user.passwordHash))) return json({ error: "Wrong email or password." }, 401);
  await startSession(user);
  // Came from "Continue with OpenCtrl" with an email that already had an account here: the password proves it's
  // theirs, so connect the two now.
  const jar = await cookies();
  const pending = openCookie<{ sub: string; email: string }>("oc-link", jar.get(LINK_COOKIE)?.value);
  if (pending) {
    jar.delete(LINK_COOKIE);
    if (pending.email === user.email && !user.openctrlSub && (await linkOpenctrl(user.id, pending.sub))) return json({ ok: true, linked: true });
  }
  return json({ ok: true });
}
