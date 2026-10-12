"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Logo, LogoMark } from "@/components/Logo";
import type { Form, FormStats } from "@/lib/types";

type Listed = Form & { stats: FormStats };

/** Cloud usage, when this install enforces limits (build plan 7.2 / 7.4). */
export interface PlanUsage {
  planName: string;
  tier: "free" | "cloud" | "unlimited";
  meters: { meter: string; unit: string; period: "month" | "current"; used: number; limit: number | null; state: "ok" | "warn" | "over" }[];
  responsesPaused: boolean;
  uploadsPaused: boolean;
  resetsAt: string;
  /** Free tier: what OPENCTRL Cloud gives instead. */
  upgrade: { price: string; url: string | null; fairUse: Record<string, number> };
  /** Subscribers: packs that raise each meter. */
  packs: Record<string, string[]>;
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : 0 });

function VerifyNotice({ state }: { state: "needed" | "done" | "failed" }) {
  const [msg, setMsg] = useState<string | null>(null);
  if (state === "done") return <p role="status" className="card mb-6 border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">Email confirmed. You can publish forms now.</p>;
  return (
    <div role="status" className="card mb-6 flex flex-wrap items-center justify-between gap-3 border-amber-300 bg-amber-50 p-4 text-sm">
      <p>
        {state === "failed" ? "That confirmation link didn't work (it may have expired). " : ""}
        <b>Confirm your email</b> to publish forms. We sent a link to your inbox.
      </p>
      <div className="flex items-center gap-3">
        {msg && <span className="text-ink-soft">{msg}</span>}
        <button
          type="button"
          className="btn-outline"
          onClick={async () => {
            const res = await fetch("/api/account/verify", { method: "POST" });
            const data = await res.json().catch(() => ({}));
            setMsg(res.ok ? (data.alreadyVerified ? "Already confirmed." : "Sent. Check your inbox.") : data.error || "Couldn't send it.");
          }}
        >
          Resend link
        </button>
      </div>
    </div>
  );
}

function UsageBanner({ usage }: { usage: PlanUsage }) {
  const shown = usage.meters.filter((m) => m.limit !== null && m.limit > 0);
  if (!shown.length) return null;
  const resets = new Date(usage.resetsAt).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const worst = shown.some((m) => m.state === "over") ? "over" : shown.some((m) => m.state === "warn") ? "warn" : "ok";
  return (
    <section aria-label="Plan usage" className={`card mb-6 p-4 ${worst === "over" ? (usage.tier === "free" ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50") : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-semibold">{usage.planName}</p>
        <p className="text-ink-soft">Monthly limits reset {resets} · Export anytime · Nothing is ever deleted for going over</p>
      </div>
      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {shown.map((m) => {
          const pct = m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 100;
          return (
            <li key={m.meter} className="text-sm">
              <p>
                <span className="font-medium capitalize">{m.meter}</span>{" "}
                <span className="text-ink-soft">
                  {fmt(m.used)} of {fmt(m.limit!)} {m.unit}
                  {m.period === "month" ? " this month" : ""}
                </span>
              </p>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-mist" role="progressbar" aria-valuenow={m.used} aria-valuemin={0} aria-valuemax={m.limit!} aria-label={`${m.meter} used`}>
                <div className={`h-full rounded-full ${m.state === "over" ? (usage.tier === "free" ? "bg-red-600" : "bg-amber-600") : m.state === "warn" ? "bg-amber-500" : "bg-brand"}`} style={{ width: `${pct}%` }} />
              </div>
              {m.state !== "ok" && usage.tier === "cloud" && usage.packs[m.meter]?.length ? (
                <p className="mt-1 text-xs text-ink-soft">{m.state === "over" ? "Over fair use; everything keeps working." : "Getting close."} Add a pack: {usage.packs[m.meter].join(", ")}.</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {usage.responsesPaused && (
        <p className="mt-3 text-sm text-red-700">Your forms aren&apos;t taking <b>new</b> responses until {resets}. People already answering can finish.</p>
      )}
      {usage.uploadsPaused && <p className="mt-1 text-sm text-red-700">Your forms aren&apos;t taking new file uploads until you free up space or upgrade.</p>}
      {usage.tier === "free" && worst !== "ok" && (
        <p className="mt-3 text-sm">
          <b>Join OPENCTRL Cloud</b> for {usage.upgrade.price}: up to {fmt(usage.upgrade.fairUse.responses ?? 0)} responses a month here, and every other OPENCTRL app too.{" "}
          {usage.upgrade.url ? <a className="font-semibold text-brand underline" href={usage.upgrade.url}>Upgrade</a> : <span className="text-ink-soft">(Coming soon.)</span>} Or self-host Clayform with no limits.
        </p>
      )}
    </section>
  );
}

export function Dashboard({
  forms: initial,
  templates,
  user,
  usage,
  removed = {},
  supportEmail,
  verification = null,
}: {
  forms: Listed[];
  templates: { id: string; name: string; blurb: string }[];
  user: { name: string; email: string };
  usage?: PlanUsage | null;
  /** Forms an admin took down, with the reason. */
  removed?: Record<string, string>;
  supportEmail?: string;
  verification?: "needed" | "done" | "failed" | null;
}) {
  const [forms, setForms] = useState(initial);
  const [picking, setPicking] = useState(initial.length === 0);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function create(body: unknown) {
    setError("");
    const res = await fetch("/api/forms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Couldn't create the form.");
    window.location.href = `/forms/${data.form.id}/edit`;
  }

  async function remove(form: Listed) {
    if (!confirm(`Delete “${form.title}” and all ${form.stats.starts} of its responses? This can't be undone.`)) return;
    const res = await fetch(`/api/forms/${form.id}`, { method: "DELETE" });
    if (res.ok) setForms((fs) => fs.filter((f) => f.id !== form.id));
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:gap-3">
          <Link href="/" className="shrink-0">
            <span className="sm:hidden">
              <LogoMark size={32} />
            </span>
            <span className="hidden sm:inline">
              <Logo size={30} />
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <button type="button" className="btn-outline" onClick={() => fileRef.current?.click()}>
              Import<span className="hidden sm:inline"> JSON</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  await create({ form: JSON.parse(await file.text()) });
                } catch {
                  setError("That file isn't valid JSON.");
                }
              }}
            />
            <button type="button" className="btn-brand" onClick={() => setPicking(true)}>
              + New<span className="hidden sm:inline"> form</span>
            </button>
            <Link
              href="/account"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-white hover:bg-black"
              title={`${user.name} · ${user.email}`}
              aria-label="Your account"
            >
              {user.name.trim().charAt(0).toUpperCase() || "?"}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {verification && <VerifyNotice state={verification} />}
        {usage && <UsageBanner usage={usage} />}
        {error && (
          <p className="mb-6 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h1 className="font-display text-3xl font-extrabold">Your forms</h1>
          <p className="text-sm text-ink-soft">{usage && usage.tier !== "unlimited" ? "Unlimited forms" : "Unlimited forms · unlimited responses"}</p>
        </div>

        {picking && (
          <section className="card mt-6 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Start from…</h2>
              {forms.length > 0 && (
                <button type="button" className="btn-ghost" onClick={() => setPicking(false)}>
                  Close
                </button>
              )}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((t) => (
                <button key={t.id} type="button" onClick={() => create({ template: t.id })} className="rounded-xl border border-ink/10 p-4 text-left transition hover:border-brand hover:bg-brand/5">
                  <span className="block font-semibold">{t.name}</span>
                  <span className="mt-1 block text-sm text-ink-soft">{t.blurb}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map((f) => {
            const rate = f.stats.views ? Math.round((f.stats.completes / f.stats.views) * 100) : 0;
            return (
              <article key={f.id} className="card flex flex-col overflow-hidden">
                <Link href={`/forms/${f.id}/edit`} className="block h-24 p-4" style={{ background: f.theme.bg, color: f.theme.text }}>
                  <span className="line-clamp-2 text-lg font-semibold">{f.title}</span>
                  <span className="mt-2 inline-block h-1.5 w-10 rounded-full" style={{ background: f.theme.accent }} />
                </Link>
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-center gap-2 text-xs">
                    {removed[f.id] ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700" title={removed[f.id]}>Removed</span>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${f.status === "published" ? "bg-emerald-100 text-emerald-800" : "bg-mist text-ink-soft"}`}>
                        {f.status === "published" ? "Live" : "Draft"}
                      </span>
                    )}
                    <span className="text-ink-soft">{f.fields.length} questions</span>
                  </div>
                  {removed[f.id] && <p className="mt-2 text-xs text-red-700">Removed by Clayform: {removed[f.id]} Its link shows a removal notice.{supportEmail && <> Think it&apos;s a mistake? Write to <a className="underline" href={`mailto:${supportEmail}`}>{supportEmail}</a>.</>}</p>}
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                    {[
                      ["Views", f.stats.views],
                      ["Done", f.stats.completes],
                      ["Rate", `${rate}%`],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-mist/50 py-1.5">
                        <dd className="font-semibold tabular-nums">{v}</dd>
                        <dt className="text-[11px] text-ink-soft">{k}</dt>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    <Link className="btn-primary px-3 py-1.5" href={`/forms/${f.id}/edit`}>
                      Edit
                    </Link>
                    <Link className="btn-outline px-3 py-1.5" href={`/forms/${f.id}/results`}>
                      Results
                    </Link>
                    <button type="button" className="btn-ghost px-2 py-1.5" onClick={() => create({ form: f, copy: true })} title="Duplicate">
                      Copy
                    </button>
                    <button type="button" className="btn-ghost ml-auto px-2 py-1.5 text-red-600" onClick={() => remove(f)}>
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}
