import { json, readJson } from "@/lib/api";
import { REPORT_REASONS, type ReportReason } from "@/lib/abuse";
import { createReport, getFormBySlug } from "@/lib/db";
import { uid } from "@/lib/fields";
import { clientIp, rateLimited } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ slug: string }> };

/** Anyone can report a public form. Stored for an admin; the reporter's IP is only used for rate limiting. */
export async function POST(req: Request, { params }: Params) {
  if (rateLimited(`report:${clientIp(req)}`, 5, 60 * 60_000)) return json({ error: "You've sent several reports. Try again later." }, 429);
  const form = await getFormBySlug((await params).slug);
  if (!form) return json({ error: "Form not found." }, 404);
  const body = await readJson<{ reason?: string; details?: string }>(req, 10_000);
  const reason = body?.reason as ReportReason | undefined;
  if (!reason || !(reason in REPORT_REASONS)) return json({ error: "Pick a reason.", field: "reason" }, 422);
  await createReport({ id: uid(14), formId: form.id, reason, details: String(body?.details ?? "").trim().slice(0, 2000), createdAt: new Date().toISOString(), resolvedAt: null, resolution: null });
  return json({ ok: true }, 201);
}
