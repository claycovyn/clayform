"use client";

import { useState } from "react";
import { usePrompt } from "@/components/ui/Dialog";
import type { Form } from "@/lib/types";
import type { Update } from "./Builder";

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const promptDialog = usePrompt();
  return (
    <button
      type="button"
      className="btn-outline shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Clipboard blocked (permissions, insecure origin): show the text selected so it can be copied by hand.
          await promptDialog({
            title: "Copy it yourself",
            body: "Your browser blocked copying. The text is selected, so copy it from here.",
            label: "Text to copy",
            defaultValue: text,
            readOnly: true,
            multiline: text.includes("\n") || text.length > 80,
          });
          return;
        }
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

function Code({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl bg-ink p-4 pr-24 text-xs leading-relaxed text-paper">
        <code>{code}</code>
      </pre>
      <div className="absolute right-2 top-2">
        <Copy text={code} />
      </div>
    </div>
  );
}

export function SharePanel({ form, update, siteUrl }: { form: Form; update: Update; siteUrl: string }) {
  const [slug, setSlug] = useState(form.slug);
  const [slugError, setSlugError] = useState("");
  const [embed, setEmbed] = useState<"inline" | "popup" | "iframe">("inline");
  const [hiddenValues, setHiddenValues] = useState<Record<string, string>>({});
  const origin = siteUrl || (typeof window !== "undefined" ? window.location.origin : "");
  const query = new URLSearchParams(Object.entries(hiddenValues).filter(([, v]) => v)).toString();
  const link = `${origin}/f/${form.slug}${query ? `?${query}` : ""}`;
  const hiddenAttr = query ? ` data-clayform-hidden="${query.replace(/"/g, "&quot;")}"` : "";

  const snippets = {
    inline: `<div data-clayform="${form.slug}"${hiddenAttr} style="width:100%;height:560px"></div>\n<script src="${origin}/embed.js" async></script>`,
    popup: `<button data-clayform-popup="${form.slug}"${hiddenAttr}>Open the form</button>\n<script src="${origin}/embed.js" async></script>`,
    iframe: `<iframe src="${origin}/f/${form.slug}?embed=1${query ? `&${query}` : ""}" title="${form.title.replace(/"/g, "&quot;")}" style="border:0;width:100%;height:560px" allow="clipboard-write"></iframe>`,
  };

  function saveSlug() {
    const next = slug.trim().toLowerCase();
    if (next === form.slug) return setSlugError("");
    if (!/^[a-z0-9-]{3,60}$/.test(next)) return setSlugError("3–60 lowercase letters, numbers and dashes.");
    setSlugError("");
    update((f) => ({ ...f, slug: next }));
  }

  return (
    <div className="order-1 min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
        <div>
          <h2 className="font-display text-2xl font-extrabold">Share</h2>
          {form.status !== "published" && (
            <p className="mt-2 rounded-xl bg-brand-light/40 p-3 text-sm">
              This form is a <b>draft</b>. Hit <b>Publish</b> (top right) before you share it — until then only you can open it.
            </p>
          )}
        </div>

        <section className="card p-5">
          <h3 className="font-semibold">Link</h3>
          <div className="mt-3 flex gap-2">
            <input className="field font-mono" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Form link" />
            <Copy text={link} />
            <a className="btn-outline shrink-0" href={link} target="_blank" rel="noopener">
              Open
            </a>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="block flex-1">
              <span className="label">Custom link</span>
              <div className="flex items-center gap-1 text-sm">
                <span className="text-ink-soft">{origin}/f/</span>
                <input className={`field font-mono ${slugError ? "border-red-500" : ""}`} value={slug} onChange={(e) => setSlug(e.target.value)} onBlur={saveSlug} onKeyDown={(e) => e.key === "Enter" && saveSlug()} />
              </div>
            </label>
          </div>
          {slugError && <p className="mt-1 text-xs text-red-600">{slugError}</p>}
          <p className="mt-2 text-xs text-ink-soft">Changing the link breaks the old one.</p>
        </section>

        {form.hiddenFields.length > 0 && (
          <section className="card p-5">
            <h3 className="font-semibold">Pre-fill hidden fields</h3>
            <p className="mt-1 text-sm text-ink-soft">Values here are added to the link and embed code above and below.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {form.hiddenFields.map((h) => (
                <label key={h} className="block">
                  <span className="label font-mono normal-case">{h}</span>
                  <input className="field" value={hiddenValues[h] ?? ""} onChange={(e) => setHiddenValues((v) => ({ ...v, [h]: e.target.value }))} />
                </label>
              ))}
            </div>
          </section>
        )}

        <section className="card p-5">
          <h3 className="font-semibold">Embed on your site</h3>
          <div className="mt-3 flex gap-1 rounded-lg bg-mist p-1 text-sm">
            {(["inline", "popup", "iframe"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setEmbed(k)} className={`flex-1 rounded-md px-3 py-1.5 capitalize ${embed === k ? "bg-white font-semibold shadow-sm" : ""}`}>
                {k === "iframe" ? "Plain iframe" : k}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <Code code={snippets[embed]} />
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            Listen for completions with <code className="rounded bg-mist px-1">window.addEventListener(&quot;message&quot;, e =&gt; e.data.type === &quot;clayform:submit&quot;)</code>.
          </p>
        </section>

        <section className="card p-5">
          <h3 className="font-semibold">Forms as code</h3>
          <p className="mt-1 text-sm text-ink-soft">
            Download this form as JSON to back it up, keep it in Git, or import it into any Clayform install. No lock-in.
          </p>
          <a className="btn-outline mt-3" href={`/api/forms/${form.id}/export?format=form`}>
            Download form JSON
          </a>
        </section>
      </div>
    </div>
  );
}
