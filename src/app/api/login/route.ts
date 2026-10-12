import { authProblem, normalizeEmail, startSession, verifyNothing, verifyPassword } from "@/lib/auth";
import { json, readJson } from "@/lib/api";
import { getUserByEmail, storageProblem } from "@/lib/db";
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
  return json({ ok: true });
}
