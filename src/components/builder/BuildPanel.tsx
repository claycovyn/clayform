"use client";

import { useState } from "react";
import { isQuestion, plainText } from "@/lib/engine";
import { choice, FIELD_TYPES, fieldMeta, newField, uid } from "@/lib/fields";
import type { Choice, Field, FieldType, Form } from "@/lib/types";
import type { Pane, Selection, Update } from "./Builder";
import { Labeled, NumberField, opt, Section, TextField, Toggle } from "./ui";

const CHOICE_TYPES: FieldType[] = ["multiple_choice", "picture_choice", "dropdown", "ranking"];

/** Rename a field key everywhere it's referenced: logic, recall tokens. */
export function renameRef(form: Form, from: string, to: string): Form {
  const swap = (text?: string) => text?.replace(new RegExp(`\\{\\{\\s*${from}\\s*\\}\\}`, "g"), `{{${to}}}`);
  return {
    ...form,
    fields: form.fields.map((f) => ({
      ...f,
      ref: f.ref === from ? to : f.ref,
      title: swap(f.title) ?? "",
      description: swap(f.description),
    })),
    logic: form.logic.map((r) => ({
      ...r,
      fromRef: r.fromRef === from ? to : r.fromRef,
      goTo: r.goTo === from ? to : r.goTo,
      conditions: r.conditions.map((c) => (c.source.kind === "field" && c.source.ref === from ? { ...c, source: { kind: "field", ref: to } } : c)),
    })),
    endings: form.endings.map((e) => ({ ...e, title: swap(e.title) ?? "", description: swap(e.description) })),
  };
}

function AddFieldMenu({ onAdd, onClose }: { onAdd: (t: FieldType) => void; onClose: () => void }) {
  const groups = ["Text", "Choice", "Scale", "Other"] as const;
  return (
    <div className="absolute left-2 right-2 top-12 z-30 max-h-[70vh] overflow-auto rounded-xl border border-ink/10 bg-white p-2 shadow-xl sm:left-full sm:right-auto sm:top-0 sm:ml-2 sm:w-[30rem]">
      <div className="mb-1 flex items-center justify-between px-2">
        <p className="text-xs font-bold uppercase tracking-wider text-ink-soft">Add a question</p>
        <button type="button" onClick={onClose} className="text-ink-soft hover:text-ink" aria-label="Close">
          ×
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g}>
            <p className="px-2 pb-1 pt-2 text-[11px] font-semibold text-ink-soft">{g}</p>
            {FIELD_TYPES.filter((m) => m.group === g).map((m) => (
              <button
                key={m.type}
                type="button"
                onClick={() => onAdd(m.type)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-mist"
              >
                <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-xs font-bold text-brand-dark">
                  {m.glyph}
                </span>
                <span>
                  <span className="block text-sm font-medium">{m.label}</span>
                  <span className="block text-[11px] text-ink-soft">{m.hint}</span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChoicesEditor({ field, change }: { field: Field; change: (patch: Partial<Field>) => void }) {
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const choices = field.choices ?? [];
  const set = (next: Choice[]) => change({ choices: next });
  const picture = field.type === "picture_choice";
  const scored = field.type !== "ranking";

  if (bulk) {
    return (
      <div className="space-y-2">
        <Labeled label="Options — one per line">
          <textarea className="field min-h-[160px] font-mono text-xs" value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
        </Labeled>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              const lines = [...new Set(bulkText.split("\n").map((l) => l.trim()).filter(Boolean))];
              set(lines.map((label) => choices.find((c) => c.label === label) ?? choice(label)));
              setBulk(false);
            }}
          >
            Apply
          </button>
          <button type="button" className="btn-ghost" onClick={() => setBulk(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label mb-0">Options</span>
        <button
          type="button"
          className="text-xs font-semibold text-brand-dark hover:underline"
          onClick={() => {
            setBulkText(choices.map((c) => c.label).join("\n"));
            setBulk(true);
          }}
        >
          Bulk edit / paste
        </button>
      </div>
      {choices.map((c, i) => (
        <div key={c.id} className="rounded-lg border border-ink/10 bg-mist/30 p-1.5">
          <div className="flex items-center gap-1">
            <input
              className="field flex-1 py-1.5"
              aria-label={`Option ${i + 1}`}
              value={c.label}
              onChange={(e) => set(choices.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))}
            />
            {scored && (
              <input
                className="field w-14 px-2 py-1.5 text-center"
                type="number"
                title="Points for this answer"
                aria-label={`Points for option ${i + 1}`}
                placeholder="pts"
                value={c.score ?? ""}
                onChange={(e) =>
                  set(choices.map((x) => (x.id === c.id ? { ...x, score: e.target.value === "" ? undefined : Number(e.target.value) } : x)))
                }
              />
            )}
            <button
              type="button"
              aria-label="Move up"
              className="px-1 text-ink-soft hover:text-ink disabled:opacity-30"
              disabled={i === 0}
              onClick={() => {
                const next = [...choices];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                set(next);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Remove option"
              className="px-1 text-ink-soft hover:text-red-600"
              onClick={() => set(choices.filter((x) => x.id !== c.id))}
            >
              ×
            </button>
          </div>
          {picture && (
            <input
              className="field mt-1 py-1 text-xs"
              placeholder="Image URL (https://…)"
              value={c.imageUrl ?? ""}
              onChange={(e) => set(choices.map((x) => (x.id === c.id ? { ...x, imageUrl: opt(e.target.value) } : x)))}
            />
          )}
        </div>
      ))}
      <button type="button" className="btn-outline w-full" onClick={() => set([...choices, choice(`Option ${choices.length + 1}`)])}>
        + Add option
      </button>
    </div>
  );
}

function FieldSettings({ form, field, update, select }: { form: Form; field: Field; update: Update; select: (s: Selection) => void }) {
  const [refDraft, setRefDraft] = useState(field.ref);
  const [refError, setRefError] = useState("");
  const index = form.fields.findIndex((f) => f.id === field.id);
  const change = (patch: Partial<Field>) =>
    update((f) => ({ ...f, fields: f.fields.map((x) => (x.id === field.id ? { ...x, ...patch } : x)) }));
  const earlier = form.fields.slice(0, index).filter(isQuestion);
  const tokens = [...earlier.map((f) => f.ref), ...form.hiddenFields, ...(form.fields.some((f) => f.choices?.some((c) => c.score)) ? ["score"] : [])];

  function move(by: number) {
    const to = index + by;
    if (to < 0 || to >= form.fields.length) return;
    update((f) => {
      const fields = [...f.fields];
      [fields[index], fields[to]] = [fields[to], fields[index]];
      return { ...f, fields };
    });
  }

  function commitRef() {
    const next = refDraft.trim();
    if (next === field.ref) return setRefError("");
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(next)) return setRefError("Letters, numbers, - and _ only.");
    if (form.fields.some((f) => f.ref === next) || form.hiddenFields.includes(next)) return setRefError("Already used.");
    setRefError("");
    update((f) => renameRef(f, field.ref, next));
  }

  const isChoice = CHOICE_TYPES.includes(field.type);
  const isText = ["short_text", "long_text", "email", "phone", "url", "number", "dropdown"].includes(field.type);

  return (
    <>
      <Section title={`${fieldMeta(field.type).label} · question ${index + 1}`}>
        <Labeled
          label="Question"
          hint={
            tokens.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                Recall:{" "}
                {tokens.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="rounded bg-mist px-1.5 py-0.5 font-mono text-[11px] hover:bg-brand-light"
                    onClick={() => change({ title: `${field.title}{{${t}}}` })}
                  >
                    {`{{${t}}}`}
                  </button>
                ))}
              </span>
            )
          }
        >
          <TextField multiline value={field.title} onChange={(v) => change({ title: v })} placeholder="What would you like to ask?" />
        </Labeled>
        <Labeled label="Description (optional)">
          <TextField multiline value={field.description} onChange={(v) => change({ description: opt(v) })} />
        </Labeled>
        {isQuestion(field) && <Toggle label="Required" checked={!!field.required} onChange={(v) => change({ required: v })} />}
        <Labeled label="Type">
          <select
            className="field"
            value={field.type}
            onChange={(e) => {
              const type = e.target.value as FieldType;
              const fresh = newField(type, form.fields);
              change({
                type,
                choices: CHOICE_TYPES.includes(type) ? field.choices ?? fresh.choices : undefined,
                steps: fresh.steps,
                scaleStart: fresh.scaleStart,
                labels: fresh.labels ?? field.labels,
                buttonLabel: fresh.buttonLabel,
              });
            }}
          >
            {FIELD_TYPES.map((m) => (
              <option key={m.type} value={m.type}>
                {m.label}
              </option>
            ))}
          </select>
        </Labeled>
      </Section>

      {isChoice && (
        <Section title="Options">
          <ChoicesEditor field={field} change={change} />
          {(field.type === "multiple_choice" || field.type === "picture_choice") && (
            <>
              <Toggle label="Allow several answers" checked={!!field.multiple} onChange={(v) => change({ multiple: v })} />
              {field.multiple && (
                <div className="grid grid-cols-2 gap-2">
                  <Labeled label="Min picks">
                    <NumberField value={field.min} min={1} onChange={(v) => change({ min: v })} />
                  </Labeled>
                  <Labeled label="Max picks">
                    <NumberField value={field.max} min={1} onChange={(v) => change({ max: v })} />
                  </Labeled>
                </div>
              )}
              {field.type === "multiple_choice" && (
                <Toggle label="“Other” option" hint="Lets people type their own answer" checked={!!field.allowOther} onChange={(v) => change({ allowOther: v })} />
              )}
              <Toggle label="Shuffle options" hint="Each respondent sees a different order" checked={!!field.randomize} onChange={(v) => change({ randomize: v })} />
            </>
          )}
        </Section>
      )}

      {(field.type === "rating" || field.type === "opinion_scale") && (
        <Section title="Scale">
          <Labeled label={field.type === "rating" ? "Stars" : "Steps"}>
            <input
              type="range"
              min={3}
              max={field.type === "rating" ? 10 : 11}
              value={field.steps ?? 5}
              onChange={(e) => change({ steps: Number(e.target.value) })}
              className="w-full accent-[#2F5BFF]"
            />
            <span className="text-xs text-ink-soft">{field.steps ?? 5}</span>
          </Labeled>
          {field.type === "opinion_scale" && (
            <Labeled label="Start at">
              <select className="field" value={field.scaleStart ?? 1} onChange={(e) => change({ scaleStart: Number(e.target.value) })}>
                <option value={0}>0</option>
                <option value={1}>1</option>
              </select>
            </Labeled>
          )}
        </Section>
      )}
      {(field.type === "opinion_scale" || field.type === "nps") && (
        <Section title="Labels">
          <div className="grid grid-cols-2 gap-2">
            <Labeled label="Left">
              <TextField value={field.labels?.left} onChange={(v) => change({ labels: { ...field.labels, left: opt(v) } })} />
            </Labeled>
            <Labeled label="Right">
              <TextField value={field.labels?.right} onChange={(v) => change({ labels: { ...field.labels, right: opt(v) } })} />
            </Labeled>
          </div>
        </Section>
      )}
      {field.type === "number" && (
        <Section title="Limits">
          <div className="grid grid-cols-2 gap-2">
            <Labeled label="Min">
              <NumberField value={field.min} onChange={(v) => change({ min: v })} />
            </Labeled>
            <Labeled label="Max">
              <NumberField value={field.max} onChange={(v) => change({ max: v })} />
            </Labeled>
          </div>
        </Section>
      )}
      {(field.type === "short_text" || field.type === "long_text") && (
        <Section title="Limits">
          <Labeled label="Max characters">
            <NumberField value={field.maxLength} min={1} onChange={(v) => change({ maxLength: v })} placeholder={field.type === "short_text" ? "500" : "10000"} />
          </Labeled>
        </Section>
      )}

      <Section title="Extras">
        {isText && field.type !== "dropdown" && (
          <Labeled label="Placeholder">
            <TextField value={field.placeholder} onChange={(v) => change({ placeholder: opt(v) })} />
          </Labeled>
        )}
        {field.type === "statement" && (
          <Labeled label="Button text">
            <TextField value={field.buttonLabel} onChange={(v) => change({ buttonLabel: opt(v) })} />
          </Labeled>
        )}
        <Labeled label="Image URL">
          <TextField value={field.imageUrl} onChange={(v) => change({ imageUrl: opt(v) })} placeholder="https://…" />
        </Labeled>
        <Labeled label="Key" hint={refError || "Used in logic, recall, exports and webhooks."}>
          <input
            className={`field font-mono ${refError ? "border-red-500" : ""}`}
            value={refDraft}
            onChange={(e) => setRefDraft(e.target.value)}
            onBlur={commitRef}
            onKeyDown={(e) => e.key === "Enter" && commitRef()}
          />
        </Labeled>
      </Section>

      <Section title="Actions">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-outline" onClick={() => move(-1)} disabled={index === 0}>
            ↑ Up
          </button>
          <button type="button" className="btn-outline" onClick={() => move(1)} disabled={index === form.fields.length - 1}>
            ↓ Down
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={() => {
              const copy: Field = { ...newField(field.type, form.fields), ...structuredClone(field), id: uid() };
              copy.ref = newField(field.type, form.fields).ref;
              copy.choices = copy.choices?.map((c) => ({ ...c, id: uid(6) }));
              update((f) => {
                const fields = [...f.fields];
                fields.splice(index + 1, 0, copy);
                return { ...f, fields };
              });
              select(`field:${copy.id}`);
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="btn-outline text-red-600"
            onClick={() => {
              update((f) => ({
                ...f,
                fields: f.fields.filter((x) => x.id !== field.id),
                logic: f.logic.filter((r) => r.fromRef !== field.ref && r.goTo !== field.ref),
              }));
              const neighbour = form.fields[index + 1] ?? form.fields[index - 1];
              select(neighbour ? `field:${neighbour.id}` : "welcome");
            }}
          >
            Delete
          </button>
        </div>
      </Section>
    </>
  );
}

function WelcomeSettings({ form, update }: { form: Form; update: Update }) {
  const w = form.welcome;
  const change = (patch: Partial<Form["welcome"]>) => update((f) => ({ ...f, welcome: { ...f.welcome, ...patch } }));
  return (
    <Section title="Welcome screen">
      <Toggle label="Show a welcome screen" checked={w.enabled} onChange={(v) => change({ enabled: v })} />
      <Labeled label="Title">
        <TextField multiline value={w.title} onChange={(v) => change({ title: v })} />
      </Labeled>
      <Labeled label="Description">
        <TextField multiline value={w.description} onChange={(v) => change({ description: opt(v) })} />
      </Labeled>
      <Labeled label="Button">
        <TextField value={w.buttonLabel} onChange={(v) => change({ buttonLabel: v })} />
      </Labeled>
      <Labeled label="Image URL">
        <TextField value={w.imageUrl} onChange={(v) => change({ imageUrl: opt(v) })} placeholder="https://…" />
      </Labeled>
    </Section>
  );
}

function EndingSettings({ form, id, update, select }: { form: Form; id: string; update: Update; select: (s: Selection) => void }) {
  const ending = form.endings.find((e) => e.id === id);
  if (!ending) return null;
  const change = (patch: Partial<typeof ending>) =>
    update((f) => ({ ...f, endings: f.endings.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  return (
    <>
      <Section title="Ending">
        <Labeled label="Title" hint="Recall works here too, e.g. Thanks {{name}} or You scored {{score}}.">
          <TextField multiline value={ending.title} onChange={(v) => change({ title: v })} />
        </Labeled>
        <Labeled label="Description">
          <TextField multiline value={ending.description} onChange={(v) => change({ description: opt(v) })} />
        </Labeled>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label="Button text">
            <TextField value={ending.buttonLabel} onChange={(v) => change({ buttonLabel: opt(v) })} />
          </Labeled>
          <Labeled label="Button link">
            <TextField value={ending.buttonUrl} onChange={(v) => change({ buttonUrl: opt(v) })} placeholder="https://…" />
          </Labeled>
        </div>
        <Labeled label="Redirect to (optional)" hint="Sends people to this page 2.5 seconds after finishing.">
          <TextField value={ending.redirectUrl} onChange={(v) => change({ redirectUrl: opt(v) })} placeholder="https://…" />
        </Labeled>
      </Section>
      <Section title="Show by score">
        <p className="text-xs text-ink-soft">Give options points (in the Options list), then show this ending when the total lands in a range. Leave blank to use logic or as the default.</p>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label="Min score">
            <NumberField value={ending.minScore} onChange={(v) => change({ minScore: v })} />
          </Labeled>
          <Labeled label="Max score">
            <NumberField value={ending.maxScore} onChange={(v) => change({ maxScore: v })} />
          </Labeled>
        </div>
      </Section>
      {form.endings.length > 1 && (
        <Section title="Actions">
          <button
            type="button"
            className="btn-outline text-red-600"
            onClick={() => {
              update((f) => ({ ...f, endings: f.endings.filter((e) => e.id !== id), logic: f.logic.filter((r) => r.goTo !== `ending:${id}`) }));
              select(`ending:${form.endings.find((e) => e.id !== id)!.id}`);
            }}
          >
            Delete ending
          </button>
        </Section>
      )}
    </>
  );
}

export function BuildPanel({
  form,
  update,
  selected,
  setSelected,
  pane,
}: {
  form: Form;
  update: Update;
  selected: Selection;
  setSelected: (s: Selection) => void;
  pane: Pane;
}) {
  const [adding, setAdding] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const selectedField = selected.startsWith("field:") ? form.fields.find((f) => f.id === selected.slice(6)) : undefined;
  let qn = 0;

  function add(type: FieldType) {
    const field = newField(type, form.fields);
    const at = selectedField ? form.fields.findIndex((f) => f.id === selectedField.id) + 1 : form.fields.length;
    update((f) => {
      const fields = [...f.fields];
      fields.splice(at, 0, field);
      return { ...f, fields };
    });
    setSelected(`field:${field.id}`);
    setAdding(false);
  }

  const item = (sel: Selection, active: boolean) =>
    `group flex w-full items-center gap-2 rounded-lg px-2 py-3 text-left text-sm transition lg:py-2 ${active ? "bg-white shadow-sm ring-1 ring-brand/40" : "hover:bg-white/70"}`;

  return (
    <>
      <aside className={`relative order-1 w-full shrink-0 flex-col border-r border-ink/10 bg-mist/60 lg:flex lg:w-64 ${pane === "list" ? "flex" : "hidden"}`}>
        <div className="relative p-2">
          <button type="button" className="btn-primary w-full" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            + Add question
          </button>
          {adding && <AddFieldMenu onAdd={add} onClose={() => setAdding(false)} />}
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2 pt-0">
          <button type="button" className={item("welcome", selected === "welcome")} onClick={() => setSelected("welcome")}>
            <span className="flex h-6 w-8 shrink-0 items-center justify-center rounded bg-ink/5 text-[10px] font-bold">Hi</span>
            <span className={`truncate ${form.welcome.enabled ? "" : "text-ink-soft line-through"}`}>Welcome</span>
          </button>
          {form.fields.map((f) => {
            const n = isQuestion(f) ? ++qn : null;
            const meta = fieldMeta(f.type);
            const hasLogic = form.logic.some((r) => r.fromRef === f.ref);
            return (
              <button
                key={f.id}
                type="button"
                draggable
                onDragStart={() => setDragId(f.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragId || dragId === f.id) return;
                  update((form) => {
                    const fields = [...form.fields];
                    const from = fields.findIndex((x) => x.id === dragId);
                    const to = fields.findIndex((x) => x.id === f.id);
                    const [moved] = fields.splice(from, 1);
                    fields.splice(to, 0, moved);
                    return { ...form, fields };
                  });
                }}
                onDragEnd={() => setDragId(null)}
                className={`${item(`field:${f.id}`, selected === `field:${f.id}`)} ${dragId === f.id ? "opacity-50" : ""}`}
                onClick={() => setSelected(`field:${f.id}`)}
              >
                <span className="flex h-6 w-8 shrink-0 items-center justify-center rounded bg-brand/10 text-[10px] font-bold text-brand-dark" title={meta.label}>
                  {meta.glyph}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {n && <span className="mr-1 text-ink-soft">{n}.</span>}
                  {plainText(f.title) || <span className="text-ink-soft">{meta.label}</span>}
                </span>
                {hasLogic && (
                  <span className="text-[10px] text-brand-dark" title="Has logic">
                    ⑂
                  </span>
                )}
                {f.required && <span className="text-brand">*</span>}
              </button>
            );
          })}
          {form.fields.length === 0 && <p className="px-2 py-4 text-sm text-ink-soft">No questions yet. Add your first one above.</p>}
          <div className="pt-3">
            <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-ink-soft">Endings</p>
            {form.endings.map((e) => (
              <button key={e.id} type="button" className={item(`ending:${e.id}`, selected === `ending:${e.id}`)} onClick={() => setSelected(`ending:${e.id}`)}>
                <span className="flex h-6 w-8 shrink-0 items-center justify-center rounded bg-ink/5 text-[10px] font-bold">✓</span>
                <span className="truncate">{plainText(e.title) || "Ending"}</span>
              </button>
            ))}
            <button
              type="button"
              className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-brand-dark hover:bg-white/70"
              onClick={() => {
                const ending = { id: uid(6), title: "Thanks!" };
                update((f) => ({ ...f, endings: [...f.endings, ending] }));
                setSelected(`ending:${ending.id}`);
              }}
            >
              + Add ending
            </button>
          </div>
        </div>
      </aside>
      <aside className={`order-3 min-w-0 flex-1 overflow-y-auto border-l border-ink/10 bg-white lg:block lg:w-80 lg:flex-none ${pane === "edit" ? "block" : "hidden"}`}>
        {selected === "welcome" && <WelcomeSettings form={form} update={update} />}
        {selectedField && <FieldSettings key={selectedField.id} form={form} field={selectedField} update={update} select={setSelected} />}
        {selected.startsWith("ending:") && <EndingSettings form={form} id={selected.slice(7)} update={update} select={setSelected} />}
      </aside>
    </>
  );
}
