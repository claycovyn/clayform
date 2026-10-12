import { json, readJson, requireOwnedForm } from "@/lib/api";
import { deleteResponses, formStats, listResponses } from "@/lib/db";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { form, denied } = await requireOwnedForm((await params).id);
  if (denied) return denied;
  return json({ responses: await listResponses(form.id), stats: await formStats(form.id) });
}

export async function DELETE(req: Request, { params }: Params) {
  const { form, denied } = await requireOwnedForm((await params).id);
  if (denied) return denied;
  const body = await readJson<{ ids?: string[] }>(req);
  if (!Array.isArray(body?.ids)) return json({ error: "Bad request." }, 400);
  await deleteResponses(form.id, body.ids.map(String));
  return json({ ok: true });
}
