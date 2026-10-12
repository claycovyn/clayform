import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { SetupNeeded } from "@/components/SetupNeeded";
import { authProblem, currentUser } from "@/lib/auth";
import { getTakedown, listForms, storageProblem } from "@/lib/db";
import { TEMPLATES } from "@/lib/templates";
import { limitStatus } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your forms" };

export default async function FormsPage() {
  const problem = storageProblem() ?? authProblem();
  if (problem) return <SetupNeeded message={problem} />;
  const user = await currentUser();
  if (!user) redirect("/login");
  const status = await limitStatus(user);
  const forms = await listForms(user.id);
  const removed: Record<string, string> = {};
  for (const f of forms) {
    const t = await getTakedown(f.id);
    if (t) removed[f.id] = t.reason;
  }
  return (
    <Dashboard
      forms={forms}
      removed={removed}
      supportEmail={process.env.CLAYFORM_SUPPORT_EMAIL || undefined}
      templates={TEMPLATES.map(({ id, name, blurb }) => ({ id, name, blurb }))}
      user={{ name: user.name, email: user.email }}
      usage={status.enforced ? { planName: status.planName, used: status.responses.used, limit: status.responses.limit, paused: status.paused, resetsAt: status.resetsAt } : null}
    />
  );
}
