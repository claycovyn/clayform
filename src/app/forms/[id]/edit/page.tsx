import { notFound, redirect } from "next/navigation";
import { Builder } from "@/components/builder/Builder";
import { currentUser } from "@/lib/auth";
import { getOwnedForm } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit form" };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const form = await getOwnedForm((await params).id, user.id);
  if (!form) notFound();
  return <Builder initial={form} siteUrl={process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? ""} />;
}
