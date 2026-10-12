import "server-only";
import { NextResponse } from "next/server";
import { currentUser } from "./auth";
import { getOwnedForm, type User } from "./db";
import type { Form } from "./types";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

/** The signed-in user, or a 401 response to return. */
export async function requireUser(): Promise<{ user: User; denied: null } | { user: null; denied: NextResponse }> {
  const user = await currentUser();
  return user ? { user, denied: null } : { user: null, denied: json({ error: "Sign in first." }, 401) };
}

/** A form the signed-in user owns, or a response to return (401 signed out, 404 not theirs or missing). */
export async function requireOwnedForm(
  id: string,
): Promise<{ user: User; form: Form; denied: null } | { user: null; form: null; denied: NextResponse }> {
  const { user, denied } = await requireUser();
  if (denied) return { user: null, form: null, denied };
  const form = await getOwnedForm(id, user.id);
  return form ? { user, form, denied: null } : { user: null, form: null, denied: json({ error: "Not found." }, 404) };
}

/** Read a JSON body with a size cap. */
export async function readJson<T>(req: Request, maxBytes = 1_000_000): Promise<T | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
