import { redirect } from "next/navigation";
import { AuthForm } from "@/components/dashboard/AuthForm";
import { AuthShell } from "@/components/dashboard/AuthShell";
import { SetupNeeded } from "@/components/SetupNeeded";
import { authProblem, currentUser } from "@/lib/auth";
import { storageProblem } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log in" };

export default async function LoginPage() {
  const problem = storageProblem() ?? authProblem();
  if (problem) return <SetupNeeded message={problem} />;
  if (await currentUser()) redirect("/forms");
  return (
    <AuthShell title="Welcome back">
      <AuthForm mode="login" />
    </AuthShell>
  );
}
