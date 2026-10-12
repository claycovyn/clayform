// Dashboard sign-in: one password from CLAYFORM_PASSWORD, a signed cookie.
import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "clayform_session";
const MAX_AGE_S = 60 * 60 * 24 * 14;

export function authConfigured(): boolean {
  return !!process.env.CLAYFORM_PASSWORD;
}

/** Without a password, the dashboard is open in development only. */
export function authDisabled(): boolean {
  return !authConfigured() && process.env.NODE_ENV !== "production";
}

function secret(): string {
  const s = process.env.CLAYFORM_SECRET || process.env.CLAYFORM_PASSWORD;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("Set CLAYFORM_PASSWORD (and CLAYFORM_SECRET).");
  return "clayform-dev-secret";
}

export function sign(value: string): string {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

export function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function checkPassword(input: string): boolean {
  const expected = process.env.CLAYFORM_PASSWORD;
  if (!expected) return false;
  return safeEqual(hash(input), hash(expected));
}

export function sessionValue(): string {
  const issued = Date.now().toString(36);
  return `${issued}.${sign(`session:${issued}`)}`;
}

export async function setSession(): Promise<void> {
  (await cookies()).set(COOKIE, sessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  if (authDisabled()) return true;
  if (!authConfigured()) return false;
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return false;
  const [issued, sig] = value.split(".");
  if (!issued || !sig || !safeEqual(sig, sign(`session:${issued}`))) return false;
  return Date.now() - parseInt(issued, 36) < MAX_AGE_S * 1000;
}
