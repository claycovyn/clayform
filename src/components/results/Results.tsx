"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { useConfirm } from "@/components/ui/Dialog";
import { displayValue, isEmpty, isQuestion, npsScore, plainText, scaleRange } from "@/lib/engine";
import type { Field, FileAnswer, Form, FormStats, ResponseRecord } from "@/lib/types";

type Tab = "summary" | "responses" | "dropoff";

function pct(n: number, d: number) {
  return d ? Math.round((n / d) * 100) : 0;
}

function duration(ms?: number) {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Bar({ label, count, total, highlight }: { label: string; count: number; total: number; highlight?: boolean }) {
  return (
    <div className="text-sm">
      <div className="mb-1 flex justify-between gap-3">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-ink-soft">
          {count} · {pct(count, total)}%
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-mist">
        <div className={`h-full rounded-full ${highlight ? "bg-brand" : "bg-ink/70"}`} style={{ width: `${pct(count, total)}%` }} />
      </div>
    </div>
  );
}

function FieldSummary({ field, responses }: { field: Field; responses: ResponseRecord[] }) {
  const values = responses.map((r) => r.answers[field.ref]).filter((v) => !isEmpty(v));
  const answered = values.length;
  let body: React.ReactNode = null;

  if (field.choices && field.type !== "ranking") {
    const counts = new Map<string, number>();
    for (const c of field.choices) counts.set(c.label, 0);
    let other = 0;
    for (const v of values) for (const label of Array.isArray(v) ? v : [String(v)]) {
      if (counts.has(label)) counts.set(label, counts.get(label)! + 1);
      else other++;
    }
    const max = Math.max(...counts.values(), other);
    body = (
      <div className="space-y-2.5">
        {[...counts].map(([label, n]) => (
          <Bar key={label} label={label} count={n} total={answered} highlight={n === max && n > 0} />
        ))}
        {other > 0 && <Bar label="Other" count={other} total={answered} />}
      </div>
    );
  } else if (field.type === "ranking") {
    const labels = (field.choices ?? []).map((c) => c.label);
    const avg = labels
      .map((label) => {
        const positions = values.map((v) => (v as string[]).indexOf(label) + 1).filter((p) => p > 0);
        return { label, avg: positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : Infinity };
      })
      .sort((a, b) => a.avg - b.avg);
    body = (
      <ol className="space-y-1 text-sm">
        {avg.map((a, i) => (
          <li key={a.label} className="flex justify-between">
            <span>
              <b className="mr-2 text-brand-dark">{i + 1}</b>
              {a.label}
            </span>
            <span className="text-ink-soft">avg. position {Number.isFinite(a.avg) ? a.avg.toFixed(1) : "—"}</span>
          </li>
        ))}
      </ol>
    );
  } else if (["rating", "opinion_scale", "nps", "number"].includes(field.type)) {
    const nums = values.map(Number).filter(Number.isFinite);
    const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    const nps = field.type === "nps" ? npsScore(nums) : null;
    const scale = field.type !== "number" ? scaleRange(field) : null;
    body = (
      <div>
        <div className="flex flex-wrap gap-6">
          {nps !== null && (
            <div>
              <div className="font-display text-4xl font-extrabold text-brand-dark">{nps > 0 ? `+${nps}` : nps}</div>
              <div className="text-xs text-ink-soft">NPS</div>
            </div>
          )}
          <div>
            <div className="font-display text-4xl font-extrabold">{nums.length ? mean.toFixed(1) : "—"}</div>
            <div className="text-xs text-ink-soft">average</div>
          </div>
          {nps !== null && (
            <div className="flex gap-4 text-sm">
              <span>
                <b>{pct(nums.filter((n) => n >= 9).length, nums.length)}%</b> promoters
              </span>
              <span>
                <b>{pct(nums.filter((n) => n >= 7 && n <= 8).length, nums.length)}%</b> passives
              </span>
              <span>
                <b>{pct(nums.filter((n) => n <= 6).length, nums.length)}%</b> detractors
              </span>
            </div>
          )}
        </div>
        {scale && (
          <div className="mt-4 flex h-24 items-end gap-1">
            {Array.from({ length: scale.end - scale.start + 1 }, (_, i) => scale.start + i).map((v) => {
              const n = nums.filter((x) => x === v).length;
              return (
                <div key={v} className="flex flex-1 flex-col items-center gap-1">
                  <div className="w-full rounded-t bg-brand/80" style={{ height: `${Math.max(pct(n, nums.length), 2) * 0.8}px` }} title={`${v}: ${n}`} />
                  <span className="text-[11px] text-ink-soft">{v}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  } else if (field.type === "yes_no" || field.type === "legal") {
    const yes = values.filter((v) => v === true).length;
    body = (
      <div className="space-y-2.5">
        <Bar label={field.type === "legal" ? "Accepted" : "Yes"} count={yes} total={answered} highlight={yes >= answered - yes} />
        <Bar label={field.type === "legal" ? "Not accepted" : "No"} count={answered - yes} total={answered} highlight={answered - yes > yes} />
      </div>
    );
  } else if (field.type === "file_upload") {
    body = <p className="text-sm text-ink-soft">{answered} file{answered === 1 ? "" : "s"} uploaded. Download them from the Responses tab.</p>;
  } else {
    body = (
      <ul className="max-h-60 space-y-1.5 overflow-auto text-sm">
        {values.slice(0, 50).map((v, i) => (
          <li key={i} className="rounded-lg bg-mist/60 px-3 py-2">
            {displayValue(v)}
          </li>
        ))}
        {values.length > 50 && <li className="text-xs text-ink-soft">…and {values.length - 50} more in the Responses tab.</li>}
      </ul>
    );
  }

  return (
    <section className="card p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h3 className="font-semibold">{plainText(field.title) || field.ref}</h3>
        <span className="shrink-0 text-xs text-ink-soft">
          {answered} of {responses.length} answered
        </span>
      </div>
      {answered === 0 ? <p className="text-sm text-ink-soft">No answers yet.</p> : body}
    </section>
  );
}

function Cell({ value }: { value: unknown }) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const f = value as FileAnswer;
    return (
      <a className="text-brand-dark underline" href={`/api/files/${f.fileId}`}>
        {f.name}
      </a>
    );
  }
  return <>{displayValue(value as never)}</>;
}

export function Results({ form, initial, stats }: { form: Form; initial: ResponseRecord[]; stats: FormStats }) {
  const [responses, setResponses] = useState(initial);
  const [tab, setTab] = useState<Tab>("summary");
  const [filter, setFilter] = useState<"complete" | "partial" | "all">("complete");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const confirmDialog = useConfirm();
  const [open, setOpen] = useState<ResponseRecord | null>(null);

  const questions = form.fields.filter(isQuestion);
  const completed = responses.filter((r) => r.completedAt);
  const avgTime = completed.length ? completed.reduce((a, r) => a + (r.meta.durationMs ?? 0), 0) / completed.length : 0;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return responses.filter((r) => {
      if (filter === "complete" && !r.completedAt) return false;
      if (filter === "partial" && r.completedAt) return false;
      if (!q) return true;
      return Object.values(r.answers).some((v) => displayValue(v).toLowerCase().includes(q));
    });
  }, [responses, filter, query]);

  async function remove(ids: string[]) {
    if (!ids.length) return;
    const many = ids.length > 1;
    const ok = await confirmDialog({
      title: many ? `Delete ${ids.length} responses` : "Delete response",
      body: `Delete ${many ? `${ids.length} responses` : "this response"} to “${form.title}”? This can't be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/forms/${form.id}/responses`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (res.ok) {
      setResponses((rs) => rs.filter((r) => !ids.includes(r.id)));
      setSelected(new Set());
      setOpen(null);
    }
  }

  const funnel = questions.map((q) => ({ field: q, reached: responses.filter((r) => !isEmpty(r.answers[q.ref])).length }));

  return (
    <div className="min-h-screen bg-mist/40">
      <header className="flex flex-wrap items-center gap-3 border-b border-ink/10 bg-white px-4 py-3">
        <Link href="/forms" title="All forms">
          <LogoMark size={28} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">{form.title}</h1>
          <p className="text-xs text-ink-soft">Results</p>
        </div>
        <Link href={`/forms/${form.id}/edit`} className="btn-outline">
          Edit form
        </Link>
        <div className="flex gap-1">
          <a className="btn-primary" href={`/api/forms/${form.id}/export?format=csv&status=${filter}`}>
            Export CSV
          </a>
          <a className="btn-outline" href={`/api/forms/${form.id}/export?format=json&status=${filter}`}>
            JSON
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ["Views", stats.views],
            ["Started", stats.starts],
            ["Completed", completed.length],
            ["Completion rate", `${pct(completed.length, Math.max(stats.views, stats.starts))}%`],
            ["Avg. time", duration(avgTime)],
          ].map(([label, value]) => (
            <div key={label} className="card p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</div>
              <div className="mt-1 font-display text-3xl font-extrabold tabular-nums">{value}</div>
            </div>
          ))}
        </div>

        <nav className="mt-6 flex gap-1 rounded-xl bg-white p-1 text-sm sm:w-fit" aria-label="Results views">
          {(
            [
              ["summary", "Summary"],
              ["responses", `Responses (${responses.length})`],
              ["dropoff", "Drop-off"],
            ] as const
          ).map(([t, label]) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`flex-1 rounded-lg px-4 py-1.5 font-medium sm:flex-none ${tab === t ? "bg-ink text-paper" : "text-ink-soft hover:bg-mist"}`}>
              {label}
            </button>
          ))}
        </nav>

        {tab === "summary" && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {questions.map((q) => (
              <FieldSummary key={q.id} field={q} responses={completed} />
            ))}
            {form.endings.length > 1 && (
              <section className="card p-5">
                <h3 className="mb-4 font-semibold">Endings reached</h3>
                <div className="space-y-2.5">
                  {form.endings.map((e) => (
                    <Bar key={e.id} label={plainText(e.title)} count={completed.filter((r) => r.endingId === e.id).length} total={completed.length} />
                  ))}
                </div>
              </section>
            )}
            {questions.length === 0 && <p className="text-sm text-ink-soft">This form has no questions yet.</p>}
          </div>
        )}

        {tab === "dropoff" && (
          <section className="card mt-4 p-5">
            <h3 className="font-semibold">Where people stop</h3>
            <p className="mt-1 text-sm text-ink-soft">Every response counts here, including unfinished ones — Clayform saves partial answers on every plan, because there are no plans.</p>
            <div className="mt-5 space-y-3">
              <Bar label="Opened the form" count={stats.views} total={Math.max(stats.views, 1)} />
              {funnel.map(({ field, reached }, i) => {
                const prev = i === 0 ? stats.starts : funnel[i - 1].reached;
                const lost = prev - reached;
                return (
                  <div key={field.id}>
                    <Bar label={`${i + 1}. ${plainText(field.title) || field.ref}`} count={reached} total={Math.max(stats.views, stats.starts, 1)} highlight={lost > 0 && lost === Math.max(...funnel.map((f, j) => (j === 0 ? stats.starts : funnel[j - 1].reached) - f.reached))} />
                    {lost > 0 && field.required && <p className="mt-0.5 text-xs text-brand-dark">−{lost} here</p>}
                  </div>
                );
              })}
              <Bar label="Finished" count={completed.length} total={Math.max(stats.views, stats.starts, 1)} />
            </div>
            <p className="mt-4 text-xs text-ink-soft">Optional and logic-skipped questions naturally show fewer answers.</p>
          </section>
        )}

        {tab === "responses" && (
          <section className="mt-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <select className="field w-auto" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter">
                <option value="complete">Completed</option>
                <option value="partial">Partial (unfinished)</option>
                <option value="all">All</option>
              </select>
              <input className="field max-w-xs" placeholder="Search answers…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search answers" />
              {selected.size > 0 && (
                <button type="button" className="btn-outline text-red-600" onClick={() => remove([...selected])}>
                  Delete {selected.size}
                </button>
              )}
            </div>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-ink/10 bg-mist/50 text-xs uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="w-8 p-3">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={shown.length > 0 && shown.every((r) => selected.has(r.id))}
                        onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())}
                      />
                    </th>
                    <th className="whitespace-nowrap p-3">Date</th>
                    {questions.slice(0, 6).map((q) => (
                      <th key={q.id} className="max-w-[12rem] truncate p-3" title={plainText(q.title)}>
                        {plainText(q.title) || q.ref}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className="cursor-pointer border-b border-ink/5 hover:bg-mist/40" onClick={() => setOpen(r)}>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Select response"
                          checked={selected.has(r.id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(r.id);
                            else next.delete(r.id);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="whitespace-nowrap p-3 text-ink-soft">
                        {new Date(r.completedAt ?? r.updatedAt).toLocaleString()}
                        {!r.completedAt && <span className="ml-2 rounded bg-brand-light/60 px-1.5 py-0.5 text-[10px] font-semibold text-brand-dark">partial</span>}
                      </td>
                      {questions.slice(0, 6).map((q) => (
                        <td key={q.id} className="max-w-[12rem] truncate p-3">
                          <Cell value={r.answers[q.ref]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-ink-soft">
                        No responses {filter === "partial" ? "in progress" : "yet"}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-40 flex justify-end bg-ink/30" onClick={() => setOpen(null)}>
          <aside className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Response">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-soft">{open.completedAt ? "Completed" : "Partial"} response</p>
                <p className="text-sm">{new Date(open.completedAt ?? open.updatedAt).toLocaleString()}</p>
              </div>
              <button type="button" className="btn-ghost" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
            <dl className="mt-6 space-y-5">
              {questions.map((q) => (
                <div key={q.id}>
                  <dt className="text-xs font-semibold text-ink-soft">{plainText(q.title) || q.ref}</dt>
                  <dd className="mt-1 whitespace-pre-wrap">{isEmpty(open.answers[q.ref]) ? <span className="text-ink-soft">—</span> : <Cell value={open.answers[q.ref]} />}</dd>
                </div>
              ))}
              {Object.entries(open.hidden).map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono text-xs text-ink-soft">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 grid grid-cols-2 gap-2 rounded-xl bg-mist/50 p-3 text-xs text-ink-soft">
              <span>Score: {open.score}</span>
              <span>Time: {duration(open.meta.durationMs)}</span>
              <span className="col-span-2">Ending: {form.endings.find((e) => e.id === open.endingId)?.title ? plainText(form.endings.find((e) => e.id === open.endingId)!.title) : "—"}</span>
              {open.meta.referrer && <span className="col-span-2 truncate">From: {open.meta.referrer}</span>}
            </div>
            <button type="button" className="btn-outline mt-6 text-red-600" onClick={() => remove([open.id])}>
              Delete response
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
