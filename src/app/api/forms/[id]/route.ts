import { json, readJson, requireAdmin } from "@/lib/api";
import { deleteForm, getForm, saveForm, slugTaken } from "@/lib/db";
import { parseForm } from "@/lib/schema";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const form = getForm((await params).id);
  return form ? json({ form }) : json({ error: "Not found." }, 404);
}

export async function PUT(req: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await params;
  const current = getForm(id);
  if (!current) return json({ error: "Not found." }, 404);
  const parsed = parseForm(await readJson(req, 5_000_000));
  if (!parsed.ok) return json({ error: parsed.error }, 422);
  const form = { ...parsed.form, id, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
  if (slugTaken(form.slug, id)) return json({ error: "That link is already used by another form." }, 409);
  saveForm(form);
  return json({ form });
}

export async function DELETE(_: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  deleteForm((await params).id);
  return json({ ok: true });
}
