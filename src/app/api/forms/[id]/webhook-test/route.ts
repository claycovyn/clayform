import { json, requireAdmin } from "@/lib/api";
import { getForm } from "@/lib/db";
import { deliverWebhook } from "@/lib/submit";
import type { ResponseRecord } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

/** Sends a sample payload so authors can check their endpoint. */
export async function POST(_: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const form = await getForm((await params).id);
  if (!form) return json({ error: "Not found." }, 404);
  if (!form.settings.webhookUrl) return json({ error: "Save a webhook URL first." }, 400);
  const now = new Date().toISOString();
  const sample: ResponseRecord = {
    id: "test_response",
    formId: form.id,
    answers: Object.fromEntries(form.fields.map((f) => [f.ref, "sample answer"])),
    hidden: {},
    score: 0,
    startedAt: now,
    updatedAt: now,
    completedAt: now,
    meta: {},
  };
  return json(await deliverWebhook(form, sample));
}
