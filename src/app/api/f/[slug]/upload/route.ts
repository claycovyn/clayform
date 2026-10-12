import { json } from "@/lib/api";
import { formOwner, getFormBySlug, saveFile } from "@/lib/db";
import { meter } from "@/lib/plans";
import { uid } from "@/lib/fields";
import { maxUploadMb } from "@/lib/limits";
import { clientIp, rateLimited } from "@/lib/rateLimit";
import { closedReason } from "@/lib/submit";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ slug: string }> };

export async function POST(req: Request, { params }: Params) {
  if (rateLimited(`upload:${clientIp(req)}`, 20)) return json({ error: "Too many uploads. Wait a minute." }, 429);
  const form = await getFormBySlug((await params).slug);
  if (!form || !form.fields.some((f) => f.type === "file_upload")) return json({ error: "Form not found." }, 404);
  const closed = await closedReason(form);
  if (closed) return json({ error: closed }, 403);

  const MAX_MB = maxUploadMb();
  const length = Number(req.headers.get("content-length") || 0);
  if (length > MAX_MB * 1024 * 1024 + 64 * 1024) return json({ error: `Files can be up to ${MAX_MB} MB.` }, 413);
  const data = await req.formData().catch(() => null);
  const file = data?.get("file");
  if (!(file instanceof File)) return json({ error: "No file received." }, 400);
  if (file.size > MAX_MB * 1024 * 1024) return json({ error: `Files can be up to ${MAX_MB} MB.` }, 413);
  if (file.size === 0) return json({ error: "That file is empty." }, 400);

  const id = uid(20);
  const name = file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200) || "upload";
  const type = (file.type || "application/octet-stream").slice(0, 100);
  await saveFile({ id, formId: form.id, name, type, size: file.size }, Buffer.from(await file.arrayBuffer()));
  await meter(await formOwner(form.id), "uploads_bytes", file.size);
  return json({ fileId: id, name, size: file.size, type });
}
