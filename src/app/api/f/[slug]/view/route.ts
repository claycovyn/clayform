import { json } from "@/lib/api";
import { countView, getFormBySlug } from "@/lib/db";
import { clientIp, rateLimited } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ slug: string }> };

export async function POST(req: Request, { params }: Params) {
  const form = getFormBySlug((await params).slug);
  if (form && form.status === "published" && !rateLimited(`view:${clientIp(req)}:${form.id}`, 5)) countView(form.id);
  return json({ ok: true });
}
