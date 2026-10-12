import fs from "node:fs/promises";
import path from "node:path";
import { json } from "@/lib/api";
import { getFormBySlug, saveFile, UPLOAD_DIR } from "@/lib/db";
import { uid } from "@/lib/fields";
import { clientIp, rateLimited } from "@/lib/rateLimit";
import { closedReason } from "@/lib/submit";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ slug: string }> };

const MAX_MB = Number(process.env.CLAYFORM_MAX_UPLOAD_MB || 10);

export async function POST(req: Request, { params }: Params) {
  if (rateLimited(`upload:${clientIp(req)}`, 20)) return json({ error: "Too many uploads. Wait a minute." }, 429);
  const form = getFormBySlug((await params).slug);
  if (!form || !form.fields.some((f) => f.type === "file_upload")) return json({ error: "Form not found." }, 404);
  const closed = closedReason(form);
  if (closed) return json({ error: closed }, 403);

  const length = Number(req.headers.get("content-length") || 0);
  if (length > MAX_MB * 1024 * 1024 + 64 * 1024) return json({ error: `Files can be up to ${MAX_MB} MB.` }, 413);
  const data = await req.formData().catch(() => null);
  const file = data?.get("file");
  if (!(file instanceof File)) return json({ error: "No file received." }, 400);
  if (file.size > MAX_MB * 1024 * 1024) return json({ error: `Files can be up to ${MAX_MB} MB.` }, 413);
  if (file.size === 0) return json({ error: "That file is empty." }, 400);

  const id = uid(20);
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, id), Buffer.from(await file.arrayBuffer()));
  const name = file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200) || "upload";
  const type = (file.type || "application/octet-stream").slice(0, 100);
  saveFile({ id, formId: form.id, name, type, size: file.size });
  return json({ fileId: id, name, size: file.size, type });
}
