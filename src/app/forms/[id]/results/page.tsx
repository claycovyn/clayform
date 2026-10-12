import { notFound, redirect } from "next/navigation";
import { Results } from "@/components/results/Results";
import { currentUser } from "@/lib/auth";
import { formStats, getOwnedForm, listResponses } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Results" };

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const form = await getOwnedForm((await params).id, user.id);
  if (!form) notFound();
  return <Results form={form} initial={await listResponses(form.id)} stats={await formStats(form.id)} />;
}
