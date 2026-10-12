import { endSession, hashPassword, PASSWORD_MIN, startSession, verifyPassword } from "@/lib/auth";
import { json, readJson, requireUser } from "@/lib/api";
import { deleteUser, getUser, updateUser } from "@/lib/db";

/** Change name and/or password. A new password needs the current one. */
export async function PATCH(req: Request) {
  const { user, denied } = await requireUser();
  if (denied) return denied;
  const body = await readJson<{ name?: string; currentPassword?: string; newPassword?: string }>(req, 10_000);
  if (!body) return json({ error: "Bad request." }, 400);

  const patch: Parameters<typeof updateUser>[1] = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 80);
    if (!name) return json({ error: "Your name can't be empty.", field: "name" }, 422);
    patch.name = name;
  }
  if (body.newPassword !== undefined) {
    if (!(await verifyPassword(String(body.currentPassword ?? ""), user.passwordHash)))
      return json({ error: "Your current password is wrong.", field: "currentPassword" }, 401);
    const next = String(body.newPassword);
    if (next.length < PASSWORD_MIN || next.length > 200)
      return json({ error: `Use at least ${PASSWORD_MIN} characters.`, field: "newPassword" }, 422);
    patch.passwordHash = await hashPassword(next);
    patch.passwordChangedAt = new Date().toISOString();
  }
  await updateUser(user.id, patch);
  // A password change signs out other sessions; keep this one signed in.
  if (patch.passwordChangedAt) await startSession((await getUser(user.id))!);
  return json({ ok: true });
}

/** Delete the account and everything in it. Needs the password. */
export async function DELETE(req: Request) {
  const { user, denied } = await requireUser();
  if (denied) return denied;
  const body = await readJson<{ password?: string }>(req, 10_000);
  if (!(await verifyPassword(String(body?.password ?? ""), user.passwordHash)))
    return json({ error: "That password is wrong.", field: "password" }, 401);
  await deleteUser(user.id);
  await endSession();
  return json({ ok: true });
}
