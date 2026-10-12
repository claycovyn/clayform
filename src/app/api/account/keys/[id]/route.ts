import { json, requireUser } from "@/lib/api";
import { revokeApiKey } from "@/lib/db";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** Revoke a key. It stops working immediately and can't be restored. */
export async function DELETE(_: Request, { params }: Params) {
  const { user, denied } = await requireUser();
  if (denied) return denied;
  return (await revokeApiKey(user.id, (await params).id)) ? json({ ok: true }) : json({ error: "Not found." }, 404);
}
