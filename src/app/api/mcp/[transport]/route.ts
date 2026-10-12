import { handleMcp } from "@/lib/mcp/handler";

// Same server at /api/mcp/mcp (the path mcp-handler-style clients expect). Other sub-paths 404.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ transport: string }> };
const route = async (req: Request, { params }: Params) => ((await params).transport === "mcp" ? handleMcp(req) : new Response("Not found", { status: 404 }));

export const GET = route;
export const POST = route;
export const DELETE = route;
