import { json, readJson } from "@/lib/api";
import { getFormBySlug } from "@/lib/db";
import { clientIp, rateLimited } from "@/lib/rateLimit";
import { submit, type SubmitBody } from "@/lib/submit";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ slug: string }> };

export async function POST(req: Request, { params }: Params) {
  if (rateLimited(`submit:${clientIp(req)}`, 120)) return json({ error: "Slow down a little and try again." }, 429);
  const form = getFormBySlug((await params).slug);
  if (!form) return json({ error: "Form not found." }, 404);
  const body = await readJson<SubmitBody>(req, 2_000_000);
  if (!body || typeof body !== "object") return json({ error: "Bad request." }, 400);
  const result = await submit(form, body, {
    userAgent: req.headers.get("user-agent") ?? undefined,
    referrer: req.headers.get("referer") ?? undefined,
  });
  return result.ok ? json(result.data) : json({ error: result.error, ref: result.ref }, result.status);
}
