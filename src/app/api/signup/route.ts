import { authProblem, hashPassword, normalizeEmail, PASSWORD_MIN, signupsOpen, startSession, validEmail } from "@/lib/auth";
import { json, readJson } from "@/lib/api";
import { claimOrphanForms, createUser, storageProblem } from "@/lib/db";
import { uid } from "@/lib/fields";
import { newUserPlan } from "@/lib/plans";
import { clientIp, rateLimited } from "@/lib/rateLimit";

export async function POST(req: Request) {
  const problem = storageProblem() ?? authProblem();
  if (problem) return json({ error: problem }, 503);
  if (!signupsOpen()) return json({ error: "Sign-ups are closed on this site." }, 403);
  if (rateLimited(`signup:${clientIp(req)}`, 10, 60 * 60_000)) return json({ error: "Too many sign-ups from here. Try again later." }, 429);

  const body = await readJson<{ name?: string; email?: string; password?: string; website?: string }>(req, 10_000);
  if (!body) return json({ error: "Bad request." }, 400);
  // Honeypot: bots fill every field. Pretend it worked.
  if (body.website) return json({ ok: true });

  const name = String(body.name ?? "").trim().slice(0, 80);
  const email = normalizeEmail(String(body.email ?? ""));
  const password = String(body.password ?? "");
  if (!name) return json({ error: "What should we call you?", field: "name" }, 422);
  if (!validEmail(email)) return json({ error: "That email doesn't look right.", field: "email" }, 422);
  if (password.length < PASSWORD_MIN) return json({ error: `Use at least ${PASSWORD_MIN} characters.`, field: "password" }, 422);
  if (password.length > 200) return json({ error: "That password is too long.", field: "password" }, 422);

  const now = new Date().toISOString();
  const user = { id: uid(16), email, name, passwordHash: await hashPassword(password), passwordChangedAt: now, createdAt: now, plan: newUserPlan() };
  if (!(await createUser(user))) return json({ error: "There's already an account with that email. Log in instead.", field: "email" }, 409);
  await claimOrphanForms(user.id);
  await startSession(user);
  return json({ ok: true }, 201);
}
