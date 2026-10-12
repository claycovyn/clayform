import { requireUser } from "@/lib/api";
import { formOwner, getFile, readStoredFile } from "@/lib/db";
import { validFileSignature } from "@/lib/fileLinks";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/**
 * Uploaded files are private: only the owner of the form can download them (signed in, or with an API key that can
 * read responses), or anyone holding a signed link that hasn't expired yet (see lib/fileLinks.ts).
 */
export async function GET(req: Request, { params }: Params) {
  const id = (await params).id;
  const url = new URL(req.url);
  const signed = validFileSignature(id, url.searchParams.get("exp"), url.searchParams.get("sig"));
  let ownerId: string | null = null;
  if (!signed) {
    const { user, denied } = await requireUser(req, "responses:read");
    if (denied) return denied;
    ownerId = user.id;
  }
  const file = await getFile(id);
  if (!file || (!signed && (await formOwner(file.formId)) !== ownerId)) return new Response("Not found", { status: 404 });
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
