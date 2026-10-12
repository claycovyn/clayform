// HTTP entry for the MCP server (Streamable HTTP, stateless, JSON responses). Every request must carry an API key:
// "Authorization: Bearer cf_…". Browser cookies are ignored here on purpose.
import "server-only";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate } from "../api";
import { bearerToken } from "../apiKeys";
import { siteUrl } from "../site";
import { createClayformMcp } from "./server";

const unauthorized = (message: string) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="clayform"', "cache-control": "no-store" },
  });

export async function handleMcp(req: Request): Promise<Response> {
  if (!bearerToken(req)) return unauthorized("Add your Clayform API key as the header “Authorization: Bearer cf_…”. Create one under Account → API keys.");
  const { caller, denied } = await authenticate(req);
  if (denied) {
    if (denied.status === 401) return unauthorized("That API key is invalid or has been revoked.");
    return denied;
  }
  const server = createClayformMcp(caller, siteUrl(req));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Stateless: nothing to keep between requests.
    void server.close();
  }
}
