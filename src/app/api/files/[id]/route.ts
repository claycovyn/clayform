import { requireUser } from "@/lib/api";
import { formOwner, getFile, readStoredFile } from "@/lib/db";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** Uploaded files are private: only the owner of the form can download them. */
export async function GET(_: Request, { params }: Params) {
  const { user, denied } = await requireUser();
  if (denied) return denied;
  const file = await getFile((await params).id);
  if (!file || (await formOwner(file.formId)) !== user.id) return new Response("Not found", { status: 404 });
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
