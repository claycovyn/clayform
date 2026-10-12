import { json, readJson, requireOwnedForm } from "@/lib/api";
import { deleteResponses, formStats, listResponses, queryResponses } from "@/lib/db";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/**
 * All responses (the dashboard), or a page of them with ?limit= (1–200), &cursor=, &since=ISO-time, &completed=1.
 * Paged results carry `nextCursor`.
 */
export async function GET(req: Request, { params }: Params) {
  const { form, denied } = await requireOwnedForm((await params).id, req, "responses:read");
  if (denied) return denied;
  const url = new URL(req.url);
  if (!url.searchParams.has("limit")) return json({ responses: await listResponses(form.id), stats: await formStats(form.id) });
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const since = url.searchParams.get("since") ?? undefined;
  if (since && Number.isNaN(Date.parse(since))) return json({ error: "since must be an ISO date or time." }, 400);
  const page = await queryResponses(form.id, {
    limit,
    cursor: url.searchParams.get("cursor") ?? undefined,
    since,
    completedOnly: ["1", "true"].includes(url.searchParams.get("completed") ?? ""),
  });
  return json({ ...page, stats: await formStats(form.id) });
}

export async function DELETE(req: Request, { params }: Params) {
  const { form, denied } = await requireOwnedForm((await params).id, req, "responses:delete");
  if (denied) return denied;
  const body = await readJson<{ ids?: string[] }>(req);
  if (!Array.isArray(body?.ids)) return json({ error: "Bad request." }, 400);
  await deleteResponses(form.id, body.ids.map(String));
  return json({ ok: true });
}
