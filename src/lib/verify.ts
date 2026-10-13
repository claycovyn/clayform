// Email verification for the hosted Cloud: a new account must confirm its email before publishing a form (abuse
// prevention, build plan 7.1). Only required when Cloud is on *and* email is configured; grandfathered accounts are
// treated as verified.
import "server-only";
import crypto from "node:crypto";
import { sign } from "./auth";
import type { User } from "./db";
import { emailConfigured, sendEmail } from "./email";
import { renderEmail, type EmailMessage } from "./emailTemplate";
import { cloudEnabled, meter, planOf } from "./plans";
import { siteUrl } from "./site";

const TTL_S = 3 * 24 * 3600;

export function needsEmailVerification(user: Pick<User, "plan" | "emailVerifiedAt">): boolean {
  return cloudEnabled() && emailConfigured() && planOf(user) !== "grandfathered" && !user.emailVerifiedAt;
}

export const VERIFY_FIRST = "Confirm your email before publishing: open the link we sent you, or resend it from your forms page.";

export function verificationLink(user: Pick<User, "id" | "email">, origin = siteUrl(), now = Date.now()): string {
  const exp = Math.floor(now / 1000) + TTL_S;
  const sig = sign(`verify:${user.id}:${user.email}:${exp}`);
  return `${origin}/api/verify?u=${encodeURIComponent(user.id)}&exp=${exp}&sig=${sig}`;
}

export function validVerification(user: Pick<User, "id" | "email">, exp: string | null, sig: string | null, now = Date.now()): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp) || Number(exp) * 1000 < now) return false;
  const expected = Buffer.from(sign(`verify:${user.id}:${user.email}:${exp}`));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** The confirmation email: a button, the raw link as a fallback, and how long it lasts. */
export function verificationEmail(user: Pick<User, "name">, link: string, origin = siteUrl()): EmailMessage {
  return renderEmail({
    subject: "Confirm your email for Clayform",
    preheader: "Confirm your email to start publishing forms.",
    heading: "Confirm your email",
    blocks: [
      { type: "paragraph", text: `Hi ${user.name},` },
      { type: "paragraph", text: "Confirm your email to start publishing forms on Clayform." },
      { type: "button", label: "Confirm email", href: link },
      { type: "link", label: "Or paste this link into your browser:", href: link },
      { type: "fineprint", text: "The link works for 3 days. If you didn't sign up, ignore this email." },
    ],
    reason: "You're getting this because this address was used to sign up for Clayform.",
    siteUrl: origin,
  });
}

export async function sendVerification(user: Pick<User, "id" | "email" | "name">, origin?: string): Promise<boolean> {
  const r = await sendEmail(user.email, verificationEmail(user, verificationLink(user, origin), origin));
  if (r.sent) await meter(user.id, "emails_sent");
  return r.sent;
}
