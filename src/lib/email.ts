// Email through Resend's HTTP API (no SDK). Every message has an HTML and a plain-text part, built by emailTemplate.ts.
// Without RESEND_API_KEY nothing is sent: the message is logged, so self-hosted installs work without email. With a key
// but no CLAYFORM_EMAIL_FROM it refuses rather than guess a sender.
import "server-only";
import type { EmailMessage } from "./emailTemplate";

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.CLAYFORM_EMAIL_FROM;
}

export async function sendEmail(to: string, { subject, html, text }: EmailMessage): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.CLAYFORM_EMAIL_FROM;
  if (!key) {
    console.log(`[email] (not sent: RESEND_API_KEY unset) to=${to} subject=${JSON.stringify(subject)}`);
    return { sent: false, error: "Email isn't configured." };
  }
  if (!from) return { sent: false, error: "Set CLAYFORM_EMAIL_FROM to send email." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, text, ...(process.env.CLAYFORM_SUPPORT_EMAIL ? { reply_to: process.env.CLAYFORM_SUPPORT_EMAIL } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { sent: false, error: `Resend answered ${res.status}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}
