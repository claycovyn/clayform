import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { SetupNeeded } from "@/components/SetupNeeded";
import { authProblem, currentUser } from "@/lib/auth";
import { getTakedown, listForms, storageProblem } from "@/lib/db";
import { TEMPLATES } from "@/lib/templates";
import { CLOUD, CLOUD_PRICE_LABEL, cloudPlanLive, limitStatus } from "@/lib/plans";
import { packsFor } from "@/lib/mcp-kit";
import { needsEmailVerification } from "@/lib/verify";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your forms" };

export default async function FormsPage({ searchParams }: { searchParams: Promise<{ verified?: string }> }) {
  const problem = storageProblem() ?? authProblem();
  if (problem) return <SetupNeeded message={problem} />;
  const user = await currentUser();
  if (!user) redirect("/login");
  const status = await limitStatus(user);
  const verifiedParam = (await searchParams).verified;
  const verification = needsEmailVerification(user) ? (verifiedParam === "0" ? "failed" : "needed") : verifiedParam === "1" ? "done" : null;
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
      verification={verification}
      templates={TEMPLATES.map(({ id, name, blurb }) => ({ id, name, blurb }))}
      user={{ name: user.name, email: user.email }}
      usage={
        status.enforced && status.tier !== "unlimited"
          ? {
              planName: status.planName,
              tier: status.tier,
              meters: status.meters.map((m) => ({ ...m, pct: undefined })),
              responsesPaused: status.responsesPaused,
              uploadsPaused: status.uploadsPaused,
              resetsAt: status.resetsAt,
              upgrade: { live: cloudPlanLive(), price: CLOUD_PRICE_LABEL, url: process.env.OPENCTRL_CLOUD_URL || null, fairUse: CLOUD.fair_use },
              packs: Object.fromEntries(Object.keys(CLOUD.meters).map((k) => [k, packsFor(CLOUD, k).map((p) => p.label)])),
            }
          : null
      }
    />
  );
}
