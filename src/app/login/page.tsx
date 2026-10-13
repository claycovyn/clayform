import { redirect } from "next/navigation";
import { AuthForm } from "@/components/dashboard/AuthForm";
import { AuthShell } from "@/components/dashboard/AuthShell";
import { OpenctrlButton } from "@/components/dashboard/OpenctrlButton";
import { SetupNeeded } from "@/components/SetupNeeded";
import { authProblem, currentUser } from "@/lib/auth";
import { storageProblem } from "@/lib/db";
import { openctrlEnabled } from "@/lib/openctrlLogin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ openctrl?: string }> }) {
  const problem = storageProblem() ?? authProblem();
  if (problem) return <SetupNeeded message={problem} />;
  if (await currentUser()) redirect("/forms");
  const { openctrl } = await searchParams;
  return (
    <AuthShell title="Welcome back">
      {(openctrlEnabled() || openctrl) && <div className="mb-4"><OpenctrlButton result={openctrl} /></div>}
      <AuthForm mode="login" />
    </AuthShell>
  );
}
