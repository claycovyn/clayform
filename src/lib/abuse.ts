// Abuse checks for hosted forms. Pure, so they're easy to test and tune.
// - Credential harvesting (asking for passwords, full card numbers, recovery phrases…) is refused on the Cloud.
// - Brand impersonation ("Verify your PayPal account") is flagged for an admin to look at, not blocked.
import type { Form } from "./types";

const CREDENTIALS: [RegExp, string][] = [
  [/\b(pass ?words?|passcodes?|passphrases?)\b/i, "asks for a password"],
  [/\b(card number|credit card number|debit card number|cvv|cvc|security code on (the|your) card)\b/i, "asks for payment card details"],
  [/\b(seed phrase|recovery phrase|secret recovery|mnemonic phrase|private key)\b/i, "asks for a wallet recovery phrase or private key"],
  [/\b(social security number|ssn)\b/i, "asks for a social security number"],
  [/\b(one[- ]time (pass)?code|otp|2fa code|authenticator code)\b/i, "asks for a login code"],
];

const BRANDS = /\b(paypal|apple ?id|icloud|microsoft (account|365)|office ?365|outlook|hotmail|gmail|google account|facebook|instagram|whatsapp|netflix|amazon|ebay|coinbase|binance|metamask|wells fargo|chase|bank of america|hsbc|barclays|irs|hmrc)\b/i;
const LURES = /\b(log ?in|sign ?in|verify|verification|suspended|locked|unlock|confirm your (account|identity)|update your (payment|billing|account)|security alert|unusual activity)\b/i;

function texts(form: Form): string[] {
  return [
    form.title,
    form.welcome.title,
    form.welcome.description ?? "",
    ...form.fields.flatMap((f) => [f.title, f.description ?? "", f.placeholder ?? "", ...(f.choices ?? []).map((c) => c.label)]),
    ...form.endings.flatMap((e) => [e.title, e.description ?? ""]),
  ];
}

/** Reasons this form can't be published on the Cloud (empty when it's fine). */
export function credentialProblems(form: Form): string[] {
  const all = texts(form).join("\n");
  return [...new Set(CREDENTIALS.filter(([re]) => re.test(all)).map(([, why]) => why))];
}

/** Signals worth a human look (impersonation lures). */
export function impersonationSignals(form: Form): string[] {
  const head = [form.title, form.welcome.title, form.welcome.description ?? ""].join("\n");
  const brand = head.match(BRANDS)?.[0];
  return brand && LURES.test(head) ? [`mentions ${brand} with a login or verification lure`] : [];
}

export function publishRefusal(form: Form): string | null {
  const problems = credentialProblems(form);
  return problems.length
    ? `Clayform Cloud doesn't allow forms that collect credentials (this one ${problems.join(", ")}). Ask for something else, or self-host Clayform.`
    : null;
}

export const REPORT_REASONS = {
  phishing: "Phishing or asks for passwords",
  spam: "Spam or scam",
  harassment: "Harassment or hate",
  illegal: "Illegal content",
  other: "Something else",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;
