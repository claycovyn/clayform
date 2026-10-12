import { checkPassword, setSession } from "@/lib/auth";
import { json, readJson } from "@/lib/api";
import { clientIp, rateLimited } from "@/lib/rateLimit";

export async function POST(req: Request) {
  if (rateLimited(`login:${clientIp(req)}`, 10)) return json({ error: "Too many tries. Wait a minute." }, 429);
  const body = await readJson<{ password?: string }>(req, 10_000);
  if (!body?.password || !checkPassword(body.password)) return json({ error: "Wrong password." }, 401);
  await setSession();
  return json({ ok: true });
}
