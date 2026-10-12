import { requireAdmin } from "@/lib/api";
import { responsesToCsv } from "@/lib/csv";
import { getForm, listResponses } from "@/lib/db";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** ?format=csv|json&status=all|complete|partial  — or ?format=form for the form definition. */
export async function GET(req: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const form = getForm((await params).id);
  if (!form) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "csv";
  const status = url.searchParams.get("status") ?? "all";
  const name = form.title.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "form";

  if (format === "form") {
    return new Response(JSON.stringify(form, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${name}.clayform.json"` },
    });
  }
  const responses = listResponses(form.id).filter((r) =>
    status === "complete" ? r.completedAt : status === "partial" ? !r.completedAt : true,
  );
  if (format === "json") {
    return new Response(JSON.stringify({ form: { id: form.id, title: form.title }, responses }, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${name}-responses.json"` },
    });
  }
  const csv = responsesToCsv(form, responses, (id) => `${siteUrl(req)}/api/files/${id}`);
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}-responses.csv"` },
  });
}
