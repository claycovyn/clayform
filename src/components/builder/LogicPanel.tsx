"use client";

import { isQuestion, lintForm, plainText } from "@/lib/engine";
import { uid } from "@/lib/fields";
import type { Condition, Field, Form, LogicRule, Operator } from "@/lib/types";
import type { Update } from "./Builder";

const OPS: { op: Operator; label: string; needsValue: boolean; numeric?: boolean }[] = [
  { op: "is", label: "is", needsValue: true },
  { op: "is_not", label: "is not", needsValue: true },
  { op: "contains", label: "contains", needsValue: true },
  { op: "not_contains", label: "doesn't contain", needsValue: true },
  { op: "starts_with", label: "starts with", needsValue: true },
  { op: "gt", label: "is greater than", needsValue: true, numeric: true },
  { op: "gte", label: "is at least", needsValue: true, numeric: true },
  { op: "lt", label: "is less than", needsValue: true, numeric: true },
  { op: "lte", label: "is at most", needsValue: true, numeric: true },
  { op: "answered", label: "is answered", needsValue: false },
  { op: "not_answered", label: "is not answered", needsValue: false },
];

function sourceKey(c: Condition): string {
  return c.source.kind === "field" ? `field:${c.source.ref}` : c.source.kind === "hidden" ? `hidden:${c.source.key}` : "score";
}

function ValueInput({ form, cond, onChange }: { form: Form; cond: Condition; onChange: (v: string) => void }) {
  const field = cond.source.kind === "field" ? form.fields.find((f) => f.ref === (cond.source as { ref: string }).ref) : undefined;
  if (field?.choices && ["is", "is_not"].includes(cond.op)) {
    return (
      <select className="field w-auto min-w-[8rem] py-1.5" value={cond.value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Pick…</option>
        {field.choices.map((c) => (
          <option key={c.id} value={c.label}>
            {c.label}
          </option>
        ))}
      </select>
    );
  }
  if ((field?.type === "yes_no" || field?.type === "legal") && ["is", "is_not"].includes(cond.op)) {
    return (
      <select className="field w-auto py-1.5" value={cond.value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Pick…</option>
        <option value="yes">{field.type === "legal" ? "accepted" : "yes"}</option>
        <option value="no">{field.type === "legal" ? "not accepted" : "no"}</option>
      </select>
    );
  }
  return <input className="field w-32 py-1.5" value={cond.value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="value" />;
}

function RuleEditor({ form, field, rule, change, remove }: { form: Form; field: Field; rule: LogicRule; change: (r: LogicRule) => void; remove: () => void }) {
  const index = form.fields.findIndex((f) => f.ref === field.ref);
  const sources = form.fields.slice(0, index + 1).filter(isQuestion);
  const hasScore = form.fields.some((f) => f.choices?.some((c) => c.score));
  const targets = form.fields.slice(index + 1);

  const setCond = (i: number, c: Condition) => change({ ...rule, conditions: rule.conditions.map((x, j) => (j === i ? c : x)) });

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-3">
      <div className="space-y-2">
        {rule.conditions.map((c, i) => {
          const op = OPS.find((o) => o.op === c.op) ?? OPS[0];
          return (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-10 shrink-0 text-xs font-bold uppercase text-ink-soft">
                {i === 0 ? "If" : (
                  <button type="button" className="rounded bg-mist px-1.5 py-0.5 hover:bg-brand-light" onClick={() => change({ ...rule, match: rule.match === "all" ? "any" : "all" })} title="Switch between AND / OR">
                    {rule.match === "all" ? "and" : "or"}
                  </button>
                )}
              </span>
              <select
                className="field w-auto max-w-[14rem] py-1.5"
                value={sourceKey(c)}
                onChange={(e) => {
                  const v = e.target.value;
                  const source: Condition["source"] =
                    v === "score" ? { kind: "score" } : v.startsWith("hidden:") ? { kind: "hidden", key: v.slice(7) } : { kind: "field", ref: v.slice(6) };
                  setCond(i, { ...c, source, value: "" });
                }}
              >
                {sources.map((f) => (
                  <option key={f.ref} value={`field:${f.ref}`}>
                    {f.title ? plainText(f.title).slice(0, 40) : f.ref}
                  </option>
                ))}
                {form.hiddenFields.map((h) => (
                  <option key={h} value={`hidden:${h}`}>
                    Hidden: {h}
                  </option>
                ))}
                {hasScore && <option value="score">Total score</option>}
              </select>
              <select className="field w-auto py-1.5" value={c.op} onChange={(e) => setCond(i, { ...c, op: e.target.value as Operator })}>
                {OPS.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>
              {op.needsValue && <ValueInput form={form} cond={c} onChange={(v) => setCond(i, { ...c, value: v })} />}
              {rule.conditions.length > 1 && (
                <button type="button" aria-label="Remove condition" className="px-1 text-ink-soft hover:text-red-600" onClick={() => change({ ...rule, conditions: rule.conditions.filter((_, j) => j !== i) })}>
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/5 pt-3 text-sm">
        <span className="w-10 shrink-0 text-xs font-bold uppercase text-brand-dark">Then</span>
        <span>go to</span>
        <select className="field w-auto max-w-[16rem] py-1.5" value={rule.goTo} onChange={(e) => change({ ...rule, goTo: e.target.value })}>
          {targets.map((f) => (
            <option key={f.ref} value={f.ref}>
              {f.title ? plainText(f.title).slice(0, 40) : f.ref}
            </option>
          ))}
          {form.endings.map((e) => (
            <option key={e.id} value={`ending:${e.id}`}>
              Ending: {plainText(e.title).slice(0, 30)}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="text-xs font-semibold text-brand-dark hover:underline"
            onClick={() => change({ ...rule, conditions: [...rule.conditions, { source: { kind: "field", ref: field.ref }, op: "is", value: "" }] })}
          >
            + condition
          </button>
          <button type="button" className="text-xs font-semibold text-red-600 hover:underline" onClick={remove}>
            Delete rule
          </button>
        </div>
      </div>
    </div>
  );
}

export function LogicPanel({ form, update }: { form: Form; update: Update }) {
  const problems = lintForm(form).filter((p) => p.includes("logic"));
  const setRule = (rule: LogicRule) => update((f) => ({ ...f, logic: f.logic.map((r) => (r.id === rule.id ? rule : r)) }));
  const removeRule = (id: string) => update((f) => ({ ...f, logic: f.logic.filter((r) => r.id !== id) }));

  return (
    <div className="order-1 min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 sm:p-8">
        <h2 className="font-display text-2xl font-extrabold">Logic</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Send people to different questions or endings based on their answers, hidden fields or score. Rules are checked top to bottom when someone leaves a question; the first match wins. No match means the next question.
        </p>
        {problems.length > 0 && (
          <ul className="mt-4 rounded-xl bg-brand-light/40 p-3 text-sm" role="alert">
            {problems.map((p) => (
              <li key={p}>⚠ {p}</li>
            ))}
          </ul>
        )}
        <ol className="mt-6 space-y-6">
          {form.fields.map((field, i) => {
            const rules = form.logic.filter((r) => r.fromRef === field.ref);
            const next = form.fields[i + 1];
            return (
              <li key={field.id} className="relative">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-paper">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{plainText(field.title) || <span className="text-ink-soft">Untitled</span>}</p>
                    <div className="mt-2 space-y-2">
                      {rules.map((r) => (
                        <RuleEditor key={r.id} form={form} field={field} rule={r} change={setRule} remove={() => removeRule(r.id)} />
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-soft">
                      <span>
                        {rules.length ? "Otherwise" : "Always"} → {next ? plainText(next.title) || `question ${i + 2}` : "ending"}
                      </span>
                      {isQuestion(field) && (
                        <button
                          type="button"
                          className="font-semibold text-brand-dark hover:underline"
                          onClick={() =>
                            update((f) => ({
                              ...f,
                              logic: [
                                ...f.logic,
                                {
                                  id: uid(6),
                                  fromRef: field.ref,
                                  match: "all",
                                  conditions: [{ source: { kind: "field", ref: field.ref }, op: field.choices ? "is" : "answered", value: field.choices?.[0]?.label ?? "" }],
                                  goTo: next?.ref ?? `ending:${f.endings[0].id}`,
                                },
                              ],
                            }))
                          }
                        >
                          + Add rule
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        {form.fields.length === 0 && <p className="mt-6 text-sm text-ink-soft">Add questions in Build first.</p>}
      </div>
    </div>
  );
}
