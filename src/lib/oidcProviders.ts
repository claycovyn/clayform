// The sign-in providers Clayform knows, read from the environment. Each is off until its client ID and secret are set.
import "server-only";
import { PROVIDER_TAG, type OidcProvider, type ProviderId } from "./oidc";

export const DEFAULT_OPENCTRL_ISSUER = "https://openctrl.app";
export const GOOGLE_ISSUER = "https://accounts.google.com";

export function providerConfig(id: ProviderId, env: Record<string, string | undefined> = process.env): OidcProvider | null {
  if (id === "openctrl") {
    const clientId = env.OPENCTRL_CLIENT_ID;
    const clientSecret = env.OPENCTRL_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    const issuer = (env.OPENCTRL_ISSUER || DEFAULT_OPENCTRL_ISSUER).replace(/\/$/, "");
    return {
      id,
      name: "OpenCtrl",
      issuer,
      issuers: [issuer],
      clientId,
      clientSecret,
      scope: "openid profile email cloud",
      tokenAuth: "basic",
      requireVerifiedEmailForNew: false,
      tag: PROVIDER_TAG.openctrl,
    };
  }
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    id,
    name: "Google",
    issuer: GOOGLE_ISSUER,
    // Google's ID tokens carry either form (Google's OpenID Connect docs).
    issuers: [GOOGLE_ISSUER, "accounts.google.com"],
    clientId,
    clientSecret,
    scope: "openid email profile",
    tokenAuth: "post",
    requireVerifiedEmailForNew: true,
    tag: PROVIDER_TAG.google,
  };
}

export const providerEnabled = (id: ProviderId) => providerConfig(id) !== null;

/** Which providers are set up, for the log-in and sign-up pages. */
export const enabledProviders = (): Record<ProviderId, boolean> => ({ openctrl: providerEnabled("openctrl"), google: providerEnabled("google") });
