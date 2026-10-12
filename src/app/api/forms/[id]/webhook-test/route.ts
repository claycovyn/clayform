import { json, requireOwnedForm } from "@/lib/api";
import { deliverWebhook } from "@/lib/submit";
import type { ResponseRecord } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

/** Sends a sample payload so authors can check their endpoint. */
export async function POST(req: Request, { params }: Params) {
  const { form, denied } = await requireOwnedForm((await params).id, req, "webhooks:write");
  if (denied) return denied;
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
