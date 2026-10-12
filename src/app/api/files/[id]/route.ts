import { requireAdmin } from "@/lib/api";
import { getFile, readStoredFile } from "@/lib/db";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** Uploaded files are private: only the dashboard can download them. */
export async function GET(_: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const file = await getFile((await params).id);
  if (!file) return new Response("Not found", { status: 404 });
  const data = await readStoredFile(file.id);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
