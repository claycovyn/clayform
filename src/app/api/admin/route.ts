import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin";
import { saveUnitCosts, ZERO_COSTS, type UnitCosts } from "@/lib/costs";
import { getForm, getUser, resolveReport, setTakedown, setUserPlan } from "@/lib/db";
import { meter, type PlanId } from "@/lib/plans";

export const dynamic = "force-dynamic";

/** Admin actions from plain HTML forms on /admin (browser session only; the cookie is SameSite=Lax). */
export async function POST(req: Request) {
  const admin = await currentAdmin();
  if (!admin) return new Response("Not found", { status: 404 });
  const f = await req.formData();
  const s = (k: string) => String(f.get(k) ?? "").trim();
  let msg = "Saved.";
  switch (s("action")) {
    case "plan": {
      const plan = s("plan") as PlanId;
      if (!["free", "pro", "grandfathered"].includes(plan) || !(await getUser(s("userId")))) return back(req, "Unknown workspace or plan.", true);
      await setUserPlan(s("userId"), plan);
      msg = `Plan set to ${plan}.`;
      break;
    }
    case "ticket":
      await meter(s("userId"), "support_tickets");
      msg = "Support ticket logged.";
      break;
    case "costs": {
      const c = Object.fromEntries(Object.keys(ZERO_COSTS).map((k) => [k, Math.max(0, Number(s(k)) || 0)])) as unknown as UnitCosts;
      await saveUnitCosts(c);
      msg = "Unit costs saved.";
      break;
    }
    case "takedown": {
      if (!(await getForm(s("formId")))) return back(req, "Unknown form.", true);
      await setTakedown(s("formId"), s("reason").slice(0, 300) || "Removed by an admin.");
      if (s("reportId")) await resolveReport(s("reportId"), "taken down");
      msg = "Form taken down. Its public link now shows a removal notice.";
      break;
    }
    case "restore":
      await setTakedown(s("formId"), null);
      msg = "Form restored.";
      break;
    case "dismiss":
      await resolveReport(s("reportId"), "dismissed");
      msg = "Report dismissed.";
      break;
    default:
      return back(req, "Unknown action.", true);
  }
  return back(req, msg);
}

function back(req: Request, message: string, error = false) {
  const url = new URL("/admin", req.url);
  url.searchParams.set(error ? "error" : "ok", message);
  return NextResponse.redirect(url, 303);
}
