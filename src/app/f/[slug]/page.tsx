import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Player } from "@/components/player/Player";
import { currentUser } from "@/lib/auth";
import { formOwner, getFormBySlug } from "@/lib/db";
import { maxUploadMb } from "@/lib/limits";
import { closedReason } from "@/lib/submit";
import { cloudEnabled, newResponsesPaused, PAUSED_MESSAGE } from "@/lib/plans";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const form = await getFormBySlug((await params).slug);
  if (!form) return { title: "Form not found" };
  return {
    title: { absolute: form.title },
    description: form.welcome.description || undefined,
    robots: { index: false },
    icons: { icon: "/favicon.svg" },
  };
}

export default async function FormPage({ params, searchParams }: Props) {
  const form = await getFormBySlug((await params).slug);
  if (!form) notFound();
  const query = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const hidden: Record<string, string> = {};
  for (const key of form.hiddenFields) {
    const v = one(query[key]);
    if (v) hidden[key] = v.slice(0, 500);
  }

  // Unpublished forms can be previewed by the owner but not answered.
  const draftPreview = form.status !== "published" && (await currentUser())?.id === (await formOwner(form.id));
  // At the plan limit, new visitors see a pause notice; people resuming a started response can still finish.
  const closed = draftPreview
    ? null
    : (await closedReason(form)) ?? (!one(query.resume) && (await newResponsesPaused(await formOwner(form.id))) ? PAUSED_MESSAGE : null);

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
        maxUploadMb={maxUploadMb()}
        reportUrl={cloudEnabled() && !draftPreview ? `/report/${form.slug}` : undefined}
      />
    </>
  );
}
