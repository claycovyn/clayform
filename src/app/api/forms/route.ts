import { json, readJson, requireAdmin } from "@/lib/api";
import { listForms, saveForm, slugTaken } from "@/lib/db";
import { uid } from "@/lib/fields";
import { parseForm } from "@/lib/schema";
import { TEMPLATES } from "@/lib/templates";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return json({ forms: listForms() });
}

/** Create from a template ({ template }) or import a form JSON ({ form }). */
export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = await readJson<{ template?: string; form?: unknown; copy?: boolean }>(req, 5_000_000);
  if (!body) return json({ error: "Bad request." }, 400);

  let form;
  if (body.form) {
    const parsed = parseForm(body.form); // unknown keys (like dashboard stats) are stripped
    if (!parsed.ok) return json({ error: `That file isn't a valid Clayform form (${parsed.error}).` }, 422);
    form = parsed.form;
    form.id = uid();
    form.status = "draft";
    form.title = `${form.title} (${body.copy ? "copy" : "imported"})`.slice(0, 200);
  } else {
    const template = TEMPLATES.find((t) => t.id === body.template) ?? TEMPLATES[0];
    form = template.build();
  }
  while (slugTaken(form.slug)) form.slug = uid(8);
  const now = new Date().toISOString();
  form.createdAt = now;
  form.updatedAt = now;
  saveForm(form);
  return json({ form }, 201);
}
