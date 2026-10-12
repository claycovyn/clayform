import { notFound, redirect } from "next/navigation";
import { Builder } from "@/components/builder/Builder";
import { isAdmin } from "@/lib/auth";
import { getForm } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit form" };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) redirect("/login");
  const form = getForm((await params).id);
  if (!form) notFound();
  return <Builder initial={form} siteUrl={process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? ""} />;
}
