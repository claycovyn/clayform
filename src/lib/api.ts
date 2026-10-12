import "server-only";
import { NextResponse } from "next/server";
import { isAdmin } from "./auth";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function requireAdmin(): Promise<NextResponse | null> {
  return (await isAdmin()) ? null : json({ error: "Sign in first." }, 401);
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
