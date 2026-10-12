import { notFound, redirect } from "next/navigation";
import { Results } from "@/components/results/Results";
import { isAdmin } from "@/lib/auth";
import { formStats, getForm, listResponses } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Results" };

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) redirect("/login");
  const form = getForm((await params).id);
  if (!form) notFound();
  return <Results form={form} initial={listResponses(form.id)} stats={formStats(form.id)} />;
}
