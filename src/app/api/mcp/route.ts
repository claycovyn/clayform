import { handleMcp } from "@/lib/mcp/handler";

// Clayform's MCP server. Connect an AI agent to https://<your-site>/api/mcp with "Authorization: Bearer cf_…".
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = handleMcp;
export const POST = handleMcp;
export const DELETE = handleMcp;
