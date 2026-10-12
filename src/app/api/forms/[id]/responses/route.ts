import { json, readJson, requireAdmin } from "@/lib/api";
import { deleteResponses, formStats, getForm, listResponses } from "@/lib/db";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await params;
  if (!getForm(id)) return json({ error: "Not found." }, 404);
  return json({ responses: listResponses(id), stats: formStats(id) });
}

export async function DELETE(req: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = await readJson<{ ids?: string[] }>(req);
  if (!Array.isArray(body?.ids)) return json({ error: "Bad request." }, 400);
  deleteResponses((await params).id, body.ids.map(String));
  return json({ ok: true });
}
