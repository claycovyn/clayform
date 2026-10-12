// Accounts: email + password (scrypt), and a signed session cookie.
// The cookie carries the user id and is signed together with the time the
// password last changed, so changing a password signs out every other session.
import "server-only";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { getUser, type User } from "./db";

const COOKIE = "clayform_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;
const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const PASSWORD_MIN = 8;

/** Production needs a real secret to sign sessions; returns a setup message when it's missing. */
export function authProblem(): string | null {
  if (!process.env.CLAYFORM_SECRET && process.env.NODE_ENV === "production")
    return "Set CLAYFORM_SECRET (any long random string) in your environment, then redeploy or restart.";
  return null;
}

/** Self-hosters can close sign-ups once their own account exists: CLAYFORM_SIGNUPS=closed. */
export function signupsOpen(): boolean {
  return (process.env.CLAYFORM_SIGNUPS ?? "open").toLowerCase() !== "closed";
}

function secret(): string {
  const s = process.env.CLAYFORM_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("CLAYFORM_SECRET is not set.");
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

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 64);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), 64);
  return safeEqual(actual.toString("base64url"), key);
}

/** Spend the same time as a real check, so response timing doesn't reveal which emails have accounts. */
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86);
export async function verifyNothing(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

function sessionValue(user: User): string {
  const issued = Date.now().toString(36);
  return `${user.id}.${issued}.${sign(`session:${user.id}:${issued}:${user.passwordChangedAt}`)}`;
}

export async function startSession(user: User): Promise<void> {
  (await cookies()).set(COOKIE, sessionValue(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The signed-in user, or null. */
export async function currentUser(): Promise<User | null> {
  if (authProblem()) return null;
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return null;
  const [id, issued, sig] = value.split(".");
  if (!id || !issued || !sig) return null;
  if (Date.now() - parseInt(issued, 36) > MAX_AGE_S * 1000) return null;
  const user = await getUser(id);
  if (!user) return null;
  return safeEqual(sig, sign(`session:${user.id}:${issued}:${user.passwordChangedAt}`)) ? user : null;
}
