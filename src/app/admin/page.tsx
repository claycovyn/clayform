import Link from "next/link";
import { notFound } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { currentAdmin } from "@/lib/admin";
import { credentialProblems, impersonationSignals, REPORT_REASONS, type ReportReason } from "@/lib/abuse";
import { UNIT_COST_LABELS, type UnitCosts } from "@/lib/costs";
import { getForm, getTakedown, listReports, publishedForms } from "@/lib/db";
import { CLOUD, cloudEnabled, PLANS } from "@/lib/plans";
import { emailConfigured } from "@/lib/email";
import { workspaceReport } from "@/lib/workspaces";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin", robots: { index: false } };

const usd = (n: number) => (Math.abs(n) < 0.01 && n !== 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ month?: string; ok?: string; error?: string }> }) {
  const admin = await currentAdmin();
  if (!admin) notFound();
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? new Date(`${sp.month}-01T00:00:00Z`) : new Date();
  const [{ rows, units, label, totals }, reports, published] = await Promise.all([workspaceReport(month), listReports(true), publishedForms()]);
  const reportForms = await Promise.all(reports.map(async (r) => ({ r, form: await getForm(r.formId), takedown: await getTakedown(r.formId) })));
  const flagged = (await Promise.all(published.map(async ({ form, ownerId }) => ({ form, ownerId, signals: [...credentialProblems(form), ...impersonationSignals(form)], takedown: await getTakedown(form.id) })))).filter((x) => x.signals.length);
  const unitsSet = Object.values(units).some((v) => v > 0);
  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-soft";
  const td = "px-3 py-2 align-top";

  return (
    <div className="min-h-screen bg-mist/40">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link href="/forms"><LogoMark size={28} /></Link>
          <span className="font-semibold">Admin</span>
          <span className="ml-auto rounded-full bg-mist px-3 py-1 text-xs font-semibold">{cloudEnabled() ? "Cloud limits ON" : "Cloud limits off (CLAYFORM_CLOUD unset)"}</span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8">
        {cloudEnabled() && !emailConfigured() && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
            Email isn&apos;t configured (RESEND_API_KEY and CLAYFORM_EMAIL_FROM), so email verification and usage notices are off. Set them before launching Free Cloud.
          </p>
        )}
        {sp.ok && <p role="status" className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{sp.ok}</p>}
        {sp.error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{sp.error}</p>}

        <section aria-labelledby="ws">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 id="ws" className="font-display text-3xl font-extrabold">Workspaces · {label}</h1>
              <p className="text-sm text-ink-soft">Sorted by margin, lowest first. Cost is an estimate from the unit costs below. Revenue is the plan price set by hand until OPENCTRL billing (build plan 7.3); an OPENCTRL Cloud subscription ($12) covers every Original, so it isn't all Clayform&apos;s.</p>
            </div>
            <form className="flex items-center gap-2 text-sm">
              <label htmlFor="month" className="text-ink-soft">Month</label>
              <input id="month" name="month" type="month" defaultValue={label} className="field w-auto" />
              <button className="btn-outline">Show</button>
            </form>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ["Workspaces", String(rows.length)],
              ["Responses (completed)", `${totals.usage.responses_started} (${totals.usage.responses_completed})`],
              ["Stored", mb(totals.storageBytes)],
              ["Est. cost", unitsSet ? usd(totals.costUsd) : "Enter unit costs"],
              ["Revenue · margin", `${usd(totals.revenueUsd)} · ${usd(totals.marginUsd)}`],
            ].map(([k, v]) => (
              <div key={k} className="card p-4"><dt className="text-xs text-ink-soft">{k}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{v}</dd></div>
            ))}
          </dl>
          <div className="card mt-4 overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="border-b border-ink/10 bg-mist/50"><tr>{["Workspace", "Plan", "Forms", "Responses", "Uploads", "Stored", "API", "Tickets", "Cost", "Revenue", "Margin", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-ink/5">
                {rows.map((r) => (
                  <tr key={r.id} className={r.marginUsd < 0 ? "bg-red-50/40" : undefined}>
                    <td className={td}><span className="font-medium">{r.email}</span><span className="block text-xs text-ink-soft">since {r.createdAt.slice(0, 10)}</span></td>
                    <td className={td}>
                      <form action="/api/admin" method="post" className="flex items-center gap-1">
                        <input type="hidden" name="action" value="plan" /><input type="hidden" name="userId" value={r.id} />
                        <select name="plan" defaultValue={r.plan} className="field w-auto py-1 text-xs" aria-label={`Plan for ${r.email}`}>
                          {Object.entries(PLANS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
                        </select>
                        <button className="btn-ghost px-2 py-1 text-xs">Set</button>
                      </form>
                      {r.overLimit && <span className="text-xs font-semibold text-red-600">at limit</span>}
                    </td>
                    <td className={`${td} tabular-nums`}>{r.forms}</td>
                    <td className={`${td} tabular-nums`}>{r.usage.responses_started} <span className="text-ink-soft">({r.usage.responses_completed})</span></td>
                    <td className={`${td} tabular-nums`}>{mb(r.usage.uploads_bytes)}</td>
                    <td className={`${td} tabular-nums`}>{mb(r.storageBytes)}</td>
                    <td className={`${td} tabular-nums`}>{r.usage.api_requests}</td>
                    <td className={`${td} tabular-nums`}>
                      <form action="/api/admin" method="post" className="flex items-center gap-1">
                        <input type="hidden" name="action" value="ticket" /><input type="hidden" name="userId" value={r.id} />
                        {r.usage.support_tickets}<button className="btn-ghost px-2 py-0.5 text-xs" aria-label={`Log a support ticket for ${r.email}`}>+1</button>
                      </form>
                    </td>
                    <td className={`${td} tabular-nums`}>{usd(r.costUsd)}</td>
                    <td className={`${td} tabular-nums`}>{usd(r.revenueUsd)}</td>
                    <td className={`${td} tabular-nums font-semibold ${r.marginUsd < 0 ? "text-red-600" : ""}`}>{usd(r.marginUsd)}</td>
                    <td className={td}>
                      <details>
                        <summary className="cursor-pointer text-xs font-semibold">Packs{Object.keys(r.packs).length ? ` (${Object.values(r.packs).reduce((a, b) => a + b, 0)})` : ""}</summary>
                        <form action="/api/admin" method="post" className="mt-2 space-y-1">
                          <input type="hidden" name="action" value="packs" /><input type="hidden" name="userId" value={r.id} />
                          {CLOUD.packs.map((p) => (
                            <label key={p.id} className="flex items-center gap-2 text-xs">
                              <input name={`pack_${p.id}`} type="number" min={0} max={1000} defaultValue={r.packs[p.id] ?? 0} className="field w-16 py-0.5" />
                              {p.label}
                            </label>
                          ))}
                          <button className="btn-ghost px-2 py-1 text-xs">Save packs</button>
                        </form>
                      </details>
                      {!r.emailVerified && r.plan !== "grandfathered" && (
                        <form action="/api/admin" method="post" className="mt-1">
                          <input type="hidden" name="action" value="verify" /><input type="hidden" name="userId" value={r.id} />
                          <button className="btn-ghost px-2 py-1 text-xs">Confirm email</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="costs" className="card p-5">
          <h2 id="costs" className="font-semibold">Unit costs (USD)</h2>
          <p className="mt-1 text-sm text-ink-soft">Fill these from the real bills (Vercel, the Postgres host, storage, email) and review them monthly. They start at $0 so no cost is made up.</p>
          <form action="/api/admin" method="post" className="mt-4 grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="action" value="costs" />
            {(Object.keys(UNIT_COST_LABELS) as (keyof UnitCosts)[]).map((k) => (
              <label key={k} className="block text-sm"><span className="label">{UNIT_COST_LABELS[k]}</span><input name={k} type="number" min={0} step="0.0001" defaultValue={units[k]} className="field" /></label>
            ))}
            <div className="sm:col-span-4"><button className="btn-primary">Save unit costs</button></div>
          </form>
        </section>

        <section aria-labelledby="reports" className="card p-5">
          <h2 id="reports" className="font-semibold">Open reports ({reports.length})</h2>
          {reportForms.length === 0 ? <p className="mt-2 text-sm text-ink-soft">Nothing reported.</p> : (
            <ul className="mt-3 divide-y divide-ink/10">
              {reportForms.map(({ r, form, takedown }) => (
                <li key={r.id} className="flex flex-wrap items-start gap-3 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{REPORT_REASONS[r.reason as ReportReason] ?? r.reason}: {form ? <a className="underline" href={`/f/${form.slug}`} target="_blank" rel="noopener">{form.title}</a> : "(deleted form)"}</p>
                    {r.details && <p className="mt-0.5 text-ink-soft">{r.details}</p>}
                    <p className="text-xs text-ink-soft">{r.createdAt.slice(0, 16).replace("T", " ")} UTC{takedown ? " · already taken down" : ""}</p>
                  </div>
                  {form && !takedown && (
                    <form action="/api/admin" method="post" className="flex gap-2">
                      <input type="hidden" name="action" value="takedown" /><input type="hidden" name="formId" value={form.id} /><input type="hidden" name="reportId" value={r.id} />
                      <input name="reason" className="field w-48 py-1 text-xs" placeholder="Reason (shown to owner)" defaultValue={REPORT_REASONS[r.reason as ReportReason]} />
                      <button className="btn bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700">Take down</button>
                    </form>
                  )}
                  <form action="/api/admin" method="post"><input type="hidden" name="action" value="dismiss" /><input type="hidden" name="reportId" value={r.id} /><button className="btn-outline px-3 py-1 text-xs">Dismiss</button></form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="flagged" className="card p-5">
          <h2 id="flagged" className="font-semibold">Flagged published forms ({flagged.length})</h2>
          <p className="mt-1 text-sm text-ink-soft">Automatic signals: asking for credentials, or a brand name with a login or verification lure. Look before acting.</p>
          {flagged.length === 0 ? <p className="mt-2 text-sm text-ink-soft">Nothing flagged.</p> : (
            <ul className="mt-3 divide-y divide-ink/10">
              {flagged.map(({ form, signals, takedown }) => (
                <li key={form.id} className="flex flex-wrap items-start gap-3 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <a className="font-medium underline" href={`/f/${form.slug}`} target="_blank" rel="noopener">{form.title}</a>
                    <p className="text-ink-soft">{signals.join("; ")}</p>
                  </div>
                  <form action="/api/admin" method="post" className="flex gap-2">
                    <input type="hidden" name="action" value={takedown ? "restore" : "takedown"} /><input type="hidden" name="formId" value={form.id} />
                    {!takedown && <input type="hidden" name="reason" value="Removed: collected credentials or impersonated a brand." />}
                    <button className={takedown ? "btn-outline px-3 py-1 text-xs" : "btn bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700"}>{takedown ? "Restore" : "Take down"}</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
