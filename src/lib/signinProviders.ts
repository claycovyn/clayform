// The log-in and sign-up screens: which provider buttons show, in what order, and the words for the last attempt.
// Order, top to bottom: Continue with OpenCtrl, Continue with Google, then the email form under "or with email".
// Each button shows only when its provider is set up; with neither, the page is just the email form.
// Pure, for tests/oidc.test.ts; the pages pass in enabledProviders() and the ?openctrl= / ?google= results.
import type { ProviderId } from "./oidc";

export const PROVIDER_ORDER: readonly ProviderId[] = ["openctrl", "google"];

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  openctrl: "Continue with OpenCtrl",
  google: "Continue with Google",
};

const NAME: Record<ProviderId, string> = { openctrl: "OpenCtrl", google: "Google" };

function message(p: ProviderId, result: string): string | undefined {
  const name = NAME[p];
  const words: Record<string, string> = {
    link: `You already have a Clayform account with this email. Log in with its password once to connect it to ${name}.`,
    cancelled: `Sign-in with ${name} was cancelled.`,
    expired: "That sign-in took too long or started somewhere else. Try again.",
    taken: `That ${name} account is already connected to a different Clayform account.`,
    noemail: `${name} didn't share an email address, so we couldn't set up your account.`,
    unverified: `Confirm your email with ${name} first, then try again.`,
    closed: "Sign-ups are closed on this site.",
    busy: "Too many tries. Wait a minute and try again.",
    off: `Sign-in with ${name} isn't set up on this site.`,
    failed: `Couldn't sign you in with ${name}. Try again, or use your email and password.`,
  };
  return Object.prototype.hasOwnProperty.call(words, result) ? words[result] : undefined;
}

export interface ProviderNotice {
  text: string;
  /** "status" for the one that asks for the password next; everything else is an error. */
  role: "status" | "alert";
}

export interface ProviderView {
  /** Buttons to show, in order. */
  buttons: ProviderId[];
  /** True when at least one button shows: one "or with email" divider goes under the last one. */
  divider: boolean;
  notices: ProviderNotice[];
}

/**
 * What the provider area shows. When a sign-in found an existing account it can't link on its own (`link`), the
 * buttons step aside so the person logs in with the password, which makes the link.
 */
export function providerView(enabled: Partial<Record<ProviderId, boolean>>, results: Partial<Record<ProviderId, string | undefined>> = {}): ProviderView {
  const notices: ProviderNotice[] = [];
  for (const p of PROVIDER_ORDER) {
    const r = results[p];
    const text = r ? message(p, r) : undefined;
    if (text) notices.push({ text, role: r === "link" ? "status" : "alert" });
  }
  const linking = PROVIDER_ORDER.some((p) => results[p] === "link");
  const buttons = linking ? [] : PROVIDER_ORDER.filter((p) => enabled[p]);
  return { buttons, divider: buttons.length > 0, notices };
}

export const startHref = (p: ProviderId) => `/api/auth/${p}/start`;
export const callbackPath = (p: ProviderId) => `/api/auth/${p}/callback`;
