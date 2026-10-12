import { notFound } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { REPORT_REASONS } from "@/lib/abuse";
import { getFormBySlug } from "@/lib/db";
import { ReportForm } from "./ReportForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Report a form", robots: { index: false } };

export default async function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await getFormBySlug(slug);
  if (!form) notFound();
  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <LogoMark size={36} />
      <h1 className="mt-6 font-display text-3xl font-extrabold">Report this form</h1>
      <p className="mt-2 text-ink-soft">
        &ldquo;{form.title}&rdquo; was made by a Clayform user, not by Clayform. Tell us if it&apos;s phishing, spam or breaks the law.
      </p>
      <ReportForm slug={slug} reasons={REPORT_REASONS} />
    </main>
  );
}
