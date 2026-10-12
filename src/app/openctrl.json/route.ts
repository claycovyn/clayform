import manifest from "../../../openctrl.json";

// The OPENCTRL manifest (repo root openctrl.json), served so OPENCTRL and agents can discover this app's MCP server.
// Self-hosted installs point at their own address.
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/$/, "");
  const official = "https://clayform.vercel.app";
  const body = site === official ? manifest : JSON.parse(JSON.stringify(manifest).replaceAll(official, site));
  return Response.json(body, { headers: { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } });
}
