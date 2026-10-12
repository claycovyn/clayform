// createOpenCtrlMcp: one function every OPENCTRL app uses to expose its MCP server.
// Stateless Streamable HTTP with JSON responses: a fresh McpServer per request, bound to whoever the request's key
// belongs to, so it runs on serverless hosts (Vercel) and a tool can only see that person's data.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { bearerToken } from "./keys.js";
import type { ToolDef } from "./tools.js";
import { ToolError } from "./tools.js";

export type AuthResult<C> = { ok: true; context: C; scopes: string[]; rateKey?: string } | { ok: false; status?: 401 | 403 | 429; message: string };

export interface AuditEvent<C> {
  tool: string;
  ok: boolean;
  ms: number;
  context: C;
  error?: string;
}

export interface OpenCtrlMcpOptions<C> {
  name: string;
  version: string;
  /** Shown to the agent on connect: what the app does and the usual order of tools. */
  instructions?: string;
  /**
   * Who is calling. Receives the bearer token (already stripped of "Bearer ") or null when none was sent.
   * Omit for a public, read-only server (like OPENCTRL's own catalogue).
   */
  authenticate?: (token: string | null, req: Request) => Promise<AuthResult<C>>;
  tools: ToolDef<C, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Return true to refuse with 429. Called with rateKey (or the client IP for public servers). */
  rateLimit?: (key: string) => boolean | Promise<boolean>;
  /** Called after every tool call (never with arguments, which may hold personal data). */
  audit?: (e: AuditEvent<C>) => void | Promise<void>;
  /** Unexpected errors land here; the agent only sees a generic sentence. */
  onError?: (tool: string, error: unknown) => void;
  origin?: (req: Request) => string;
  /** Realm in WWW-Authenticate. Defaults to `name`. */
  realm?: string;
}

const jsonError = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: status === 401 ? -32001 : -32000, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/** Builds the McpServer for one request. Exposed for tests and for apps with their own transport. */
export function buildServer<C>(opts: OpenCtrlMcpOptions<C>, context: C, scopes: string[], req: Request): McpServer {
  const server = new McpServer({ name: opts.name, version: opts.version }, opts.instructions ? { instructions: opts.instructions } : undefined);
  const origin = opts.origin?.(req) ?? new URL(req.url).origin;
  for (const t of opts.tools) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.input,
        annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive, idempotentHint: !!(t.idempotent ?? t.readOnly), openWorldHint: false },
      },
      (async (args: never) => {
        const started = Date.now();
        const finish = async (ok: boolean, error?: string) => {
          try {
            await opts.audit?.({ tool: t.name, ok, ms: Date.now() - started, context, ...(error ? { error } : {}) });
          } catch (e) {
            opts.onError?.(t.name, e);
          }
        };
        if (t.scope && !scopes.includes(t.scope)) {
          const msg = `This API key can't use ${t.name}: it needs the "${t.scope}" permission. The account owner can create a key with it in ${opts.name}.`;
          await finish(false, "missing_scope");
          return { isError: true, content: [{ type: "text", text: msg }] };
        }
        try {
          const out = await t.run(args, { context, scopes, origin, req });
          await finish(true);
          return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
        } catch (e) {
          if (e instanceof ToolError || (e as Error)?.name === "ToolError" || (e as { agentMessage?: boolean })?.agentMessage) {
            await finish(false, "tool_error");
            return { isError: true, content: [{ type: "text", text: (e as Error).message }] };
          }
          opts.onError?.(t.name, e);
          await finish(false, "server_error");
          return { isError: true, content: [{ type: "text", text: `Something went wrong in ${opts.name}. Try again in a moment.` }] };
        }
      }) as never,
    );
  }
  return server;
}

/** A fetch-style handler for GET/POST/DELETE on your MCP route: `export const POST = handler`. */
export function createOpenCtrlMcp<C>(opts: OpenCtrlMcpOptions<C>): (req: Request) => Promise<Response> {
  const realm = opts.realm ?? opts.name;
  return async (req) => {
    let context = undefined as C;
    let scopes: string[] = [];
    let rateKey = `ip:${clientIp(req)}`;
    if (opts.authenticate) {
      const token = bearerToken(req);
      const result = await opts.authenticate(token || null, req);
      if (!result.ok) {
        const status = result.status ?? 401;
        return jsonError(status, result.message, status === 401 ? { "www-authenticate": `Bearer realm="${realm}"` } : status === 429 ? { "retry-after": "60" } : {});
      }
      context = result.context;
      scopes = result.scopes;
      rateKey = result.rateKey ?? rateKey;
    }
    if (opts.rateLimit && (await opts.rateLimit(rateKey))) return jsonError(429, "Too many requests. Try again in a minute.", { "retry-after": "60" });
    const server = buildServer(opts, context, scopes, req);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req);
    } finally {
      void server.close();
    }
  };
}
