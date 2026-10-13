import { redirect } from "next/navigation";
import { AuthForm } from "@/components/dashboard/AuthForm";
import { AuthShell } from "@/components/dashboard/AuthShell";
import { ProviderButtons } from "@/components/dashboard/ProviderButtons";
import { SetupNeeded } from "@/components/SetupNeeded";
import { authProblem, currentUser } from "@/lib/auth";
import { storageProblem } from "@/lib/db";
import { enabledProviders } from "@/lib/oidcProviders";
import { providerView } from "@/lib/signinProviders";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ openctrl?: string; google?: string }> }) {
  const problem = storageProblem() ?? authProblem();
  if (problem) return <SetupNeeded message={problem} />;
  if (await currentUser()) redirect("/forms");
  const { openctrl, google } = await searchParams;
  return (
    <AuthShell title="Welcome back">
      <ProviderButtons view={providerView(enabledProviders(), { openctrl, google })} />
      <AuthForm mode="login" />
    </AuthShell>
  );
}
