import { json, missingScope, readJson, requireOwnedForm } from "@/lib/api";
import { deleteForm, saveForm, slugTaken } from "@/lib/db";
import { parseForm } from "@/lib/schema";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { form, denied } = await requireOwnedForm((await params).id, req, "forms:read");
  return denied ?? json({ form });
}

export async function PUT(req: Request, { params }: Params) {
  const { user, form: current, caller, denied } = await requireOwnedForm((await params).id, req, "forms:write");
  if (denied) return denied;
  const parsed = parseForm(await readJson(req, 5_000_000));
  if (!parsed.ok) return json({ error: parsed.error }, 422);
  // Pointing responses at a new URL needs the webhook permission, not just forms:write.
  const hookChanged =
    (parsed.form.settings.webhookUrl ?? "") !== (current.settings.webhookUrl ?? "") ||
    (parsed.form.settings.webhookSecret ?? "") !== (current.settings.webhookSecret ?? "");
  const forbidden = hookChanged ? missingScope(caller, "webhooks:write") : null;
  if (forbidden) return forbidden;
  const form = { ...parsed.form, id: current.id, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
  if (await slugTaken(form.slug, current.id)) return json({ error: "That link is already used by another form." }, 409);
  await saveForm(form, user.id);
  return json({ form });
}

export async function DELETE(req: Request, { params }: Params) {
  const { form, denied } = await requireOwnedForm((await params).id, req, "forms:write");
  if (denied) return denied;
  await deleteForm(form.id);
  return json({ ok: true });
}
