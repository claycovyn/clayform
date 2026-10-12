// Webhooks make the server send requests to URLs that users type in. On a
// shared install that must not reach the server's own network (databases,
// cloud metadata at 169.254.169.254, admin panels), so private addresses are
// refused unless the operator opts in with CLAYFORM_ALLOW_PRIVATE_WEBHOOKS=1.
import "server-only";
import dns from "node:dns/promises";
import net from "node:net";

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return privateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

/** Returns a reason the URL can't be called, or null when it's fine. */
export async function webhookBlocked(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That isn't a valid URL.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Webhooks must use http or https.";
  if (process.env.CLAYFORM_ALLOW_PRIVATE_WEBHOOKS === "1") return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return "Webhooks can't call private addresses.";
  try {
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (addrs.some((a) => isPrivateAddress(a.address))) return "Webhooks can't call private addresses.";
  } catch {
    return "Couldn't find that host.";
  }
  return null;
}
