import { json } from "@/lib/api";
import { getFormBySlug } from "@/lib/db";
import { clientIp, rateLimited } from "@/lib/rateLimit";
import { resume } from "@/lib/submit";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ slug: string }> };

export async function GET(req: Request, { params }: Params) {
  if (rateLimited(`resume:${clientIp(req)}`, 60)) return json({ error: "Too many requests." }, 429);
  const form = getFormBySlug((await params).slug);
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const token = url.searchParams.get("token") ?? "";
  const response = form && form.settings.allowResume ? resume(form, id, token) : null;
  if (!response) return json({ error: "Nothing to resume." }, 404);
  return json({
    answers: response.answers,
    hidden: response.hidden,
    lastRef: response.lastRef,
    completed: !!response.completedAt,
    endingId: response.endingId,
  });
}
