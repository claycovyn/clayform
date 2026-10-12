// Clayform admins: signed-in users whose email is in CLAYFORM_ADMIN_EMAILS (comma-separated). Browser session only.
import "server-only";
import { currentUser } from "./auth";
import type { User } from "./db";

export function adminEmails(): string[] {
  return (process.env.CLAYFORM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isAdmin(user: Pick<User, "email"> | null): boolean {
  return !!user && adminEmails().includes(user.email.toLowerCase());
}

export async function currentAdmin(): Promise<User | null> {
  const user = await currentUser();
  return isAdmin(user) ? user : null;
}
