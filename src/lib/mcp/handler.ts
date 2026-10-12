// HTTP entry for the MCP server, built with the shared OPENCTRL kit (stateless Streamable HTTP, JSON responses).
// Every request must carry an API key: "Authorization: Bearer cf_…". Browser cookies are ignored here on purpose.
import "server-only";
import { authenticate, type Caller } from "../api";
import { createOpenCtrlMcp } from "../mcp-kit";
import { siteUrl } from "../site";
import { INSTRUCTIONS, SERVER_NAME, SERVER_VERSION, TOOLS } from "./server";

export const handleMcp = createOpenCtrlMcp<Caller>({
  name: SERVER_NAME,
  version: SERVER_VERSION,
  instructions: INSTRUCTIONS,
  realm: "clayform",
  tools: TOOLS,
  origin: (req) => siteUrl(req),
  async authenticate(token, req) {
    if (!token) return { ok: false, message: "Add your Clayform API key as the header “Authorization: Bearer cf_…”. Create one under Account → API keys." };
    // Same check as the REST API: valid, unrevoked key, and 120 requests a minute per key.
    const { caller, denied } = await authenticate(req);
    if (denied) return denied.status === 429 ? { ok: false, status: 429, message: "Too many requests for this API key. Try again in a minute." } : { ok: false, message: "That API key is invalid or has been revoked." };
    return { ok: true, context: caller, scopes: caller.scopes };
  },
  onError: (tool, e) => console.error(`[mcp] ${tool} failed`, e),
});
