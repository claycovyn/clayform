import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/dashboard/AuthForm";
import { AuthShell } from "@/components/dashboard/AuthShell";
import { SetupNeeded } from "@/components/SetupNeeded";
import { authProblem, currentUser, signupsOpen } from "@/lib/auth";
import { storageProblem } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create your account" };

export default async function SignupPage() {
  const problem = storageProblem() ?? authProblem();
  if (problem) return <SetupNeeded message={problem} />;
  if (await currentUser()) redirect("/forms");
  if (!signupsOpen())
    return (
      <AuthShell title="Sign-ups are closed" subtitle="This Clayform site isn't taking new accounts.">
        <Link href="/login" className="btn-brand w-full py-3">
          Log in
        </Link>
      </AuthShell>
    );
  return (
    <AuthShell title="Make forms people finish" subtitle="Free forever. No response limits. No card needed.">
      <AuthForm mode="signup" />
    </AuthShell>
  );
}
