import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Player } from "@/components/player/Player";
import { isAdmin } from "@/lib/auth";
import { getFormBySlug } from "@/lib/db";
import { closedReason } from "@/lib/submit";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const form = getFormBySlug((await params).slug);
  if (!form) return { title: "Form not found" };
  return {
    title: { absolute: form.title },
    description: form.welcome.description || undefined,
    robots: { index: false },
    icons: { icon: "/favicon.svg" },
  };
}

export default async function FormPage({ params, searchParams }: Props) {
  const form = getFormBySlug((await params).slug);
  if (!form) notFound();
  const query = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const hidden: Record<string, string> = {};
  for (const key of form.hiddenFields) {
    const v = one(query[key]);
    if (v) hidden[key] = v.slice(0, 500);
  }

  // Unpublished forms can be previewed by the owner but not answered.
  const draftPreview = form.status !== "published" && (await isAdmin());
  const closed = draftPreview ? null : closedReason(form);

  return (
    <>
      {draftPreview && (
        <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-paper shadow">
          Draft preview — answers aren&apos;t saved. Publish to share.
        </div>
      )}
      <Player
        form={form}
        preview={draftPreview}
        embedded={one(query.embed) === "1"}
        initialHidden={hidden}
        resumeParam={one(query.resume)}
        closedMessage={closed}
      />
    </>
  );
}
