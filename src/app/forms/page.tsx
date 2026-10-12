import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { SetupNeeded } from "@/components/SetupNeeded";
import { authProblem, currentUser } from "@/lib/auth";
import { listForms, storageProblem } from "@/lib/db";
import { TEMPLATES } from "@/lib/templates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your forms" };

export default async function FormsPage() {
  const problem = storageProblem() ?? authProblem();
  if (problem) return <SetupNeeded message={problem} />;
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <Dashboard
      forms={await listForms(user.id)}
      templates={TEMPLATES.map(({ id, name, blurb }) => ({ id, name, blurb }))}
      user={{ name: user.name, email: user.email }}
    />
  );
}
