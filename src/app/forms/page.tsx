import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { authDisabled, isAdmin } from "@/lib/auth";
import { SetupNeeded } from "@/components/SetupNeeded";
import { listForms, storageProblem } from "@/lib/db";
import { TEMPLATES } from "@/lib/templates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your forms" };

export default async function FormsPage() {
  if (!(await isAdmin())) redirect("/login");
  const problem = storageProblem();
  if (problem) return <SetupNeeded message={problem} />;
  return (
    <Dashboard
      forms={await listForms()}
      templates={TEMPLATES.map(({ id, name, blurb }) => ({ id, name, blurb }))}
      openDev={authDisabled()}
    />
  );
}
