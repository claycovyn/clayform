import { json, readJson, requireOwnedForm } from "@/lib/api";
import { deleteForm, saveForm, slugTaken } from "@/lib/db";
import { parseForm } from "@/lib/schema";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { form, denied } = await requireOwnedForm((await params).id);
  return denied ?? json({ form });
}

export async function PUT(req: Request, { params }: Params) {
  const { user, form: current, denied } = await requireOwnedForm((await params).id);
  if (denied) return denied;
  const parsed = parseForm(await readJson(req, 5_000_000));
  if (!parsed.ok) return json({ error: parsed.error }, 422);
  const form = { ...parsed.form, id: current.id, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
  if (await slugTaken(form.slug, current.id)) return json({ error: "That link is already used by another form." }, 409);
  await saveForm(form, user.id);
  return json({ form });
}

export async function DELETE(_: Request, { params }: Params) {
  const { form, denied } = await requireOwnedForm((await params).id);
  if (denied) return denied;
  await deleteForm(form.id);
  return json({ ok: true });
}
