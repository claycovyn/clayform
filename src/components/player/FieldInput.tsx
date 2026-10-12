"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { scaleRange, seededShuffle } from "@/lib/engine";
import type { AnswerValue, Field, FileAnswer } from "@/lib/types";

export interface InputProps {
  field: Field;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
  /** Move on. Pass the value when it was just set (state may not have updated yet). */
  onSubmit: (value?: AnswerValue) => void;
  /** Conversational mode: this question is on screen alone and owns the keyboard. */
  active: boolean;
  /** Letter/number shortcuts and autofocus. Off inside the builder preview so it doesn't steal the keyboard. */
  owner: boolean;
  autoAdvance: boolean;
  slug: string;
  preview: boolean;
  seed: string;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const tint = (pct: number) => `color-mix(in srgb, var(--cf-accent) ${pct}%, transparent)`;

function typingInField(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

/** Global keyboard shortcuts while a question is active. */
function useKeys(active: boolean, handler: (e: KeyboardEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const listener = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typingInField(e)) return;
      ref.current(e);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [active]);
}

function KeyBadge({ k, on }: { k: string; on?: boolean }) {
  return (
    <span
      className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded px-1 text-xs font-bold"
      style={{
        border: "1px solid var(--cf-accent)",
        background: on ? "var(--cf-accent)" : "transparent",
        color: on ? "var(--cf-btn-text)" : "var(--cf-accent)",
      }}
      aria-hidden="true"
    >
      {k}
    </span>
  );
}

const textInputStyle: React.CSSProperties = {
  color: "var(--cf-text)",
  borderBottom: "2px solid color-mix(in srgb, var(--cf-accent) 45%, transparent)",
  caretColor: "var(--cf-accent)",
};

function TextLike({ field, value, onChange, onSubmit, active, owner }: InputProps) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => {
    if (active && owner) ref.current?.focus({ preventScroll: true });
  }, [active, owner]);
  const common = {
    className: "input-reset w-full py-2 text-xl sm:text-2xl placeholder:opacity-40 focus:border-b-[color:var(--cf-accent)]",
    style: textInputStyle,
    placeholder: field.placeholder || (field.type === "email" ? "name@example.com" : "Type your answer here…"),
    "aria-labelledby": `q-${field.id}`,
  };
  if (field.type === "long_text") {
    return (
      <div>
        <textarea
          {...common}
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          rows={3}
          maxLength={field.maxLength ?? 10000}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && active) {
              e.preventDefault();
              onSubmit();
            }
          }}
          className={`${common.className} resize-none`}
        />
        {active && (
          <p className="mt-2 text-xs opacity-60">
            <b>Shift ⇧ + Enter ↵</b> for a new line
          </p>
        )}
      </div>
    );
  }
  const type = { email: "email", phone: "tel", url: "url", number: "text", date: "date" }[field.type as string] ?? "text";
  return (
    <input
      {...common}
      ref={ref as React.RefObject<HTMLInputElement>}
      type={type}
      inputMode={field.type === "number" ? "decimal" : field.type === "phone" ? "tel" : undefined}
      autoComplete={field.type === "email" ? "email" : field.type === "phone" ? "tel" : field.ref === "name" ? "name" : "off"}
      maxLength={field.type === "short_text" ? field.maxLength ?? 500 : undefined}
      value={value === null || value === undefined ? "" : String(value)}
      onChange={(e) => {
        const v = e.target.value;
        if (field.type === "number") onChange(v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : v);
        else onChange(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && active) {
          e.preventDefault();
          onSubmit();
        }
      }}
    />
  );
}

function Choices(props: InputProps) {
  const { field, value, onChange, onSubmit, active, autoAdvance, seed } = props;
  const choices = useMemo(
    () => (field.randomize ? seededShuffle(field.choices ?? [], seed + field.id) : field.choices ?? []),
    [field.choices, field.randomize, field.id, seed],
  );
  const picked = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const labels = new Set(choices.map((c) => c.label));
  const otherValue = picked.find((p) => !labels.has(p));
  const [otherOpen, setOtherOpen] = useState(otherValue !== undefined);
  const [otherText, setOtherText] = useState(otherValue ?? "");
  const otherRef = useRef<HTMLInputElement>(null);
  const picture = field.type === "picture_choice";

  function commit(next: string[]) {
    if (field.multiple) onChange(next.length ? next : null);
    else onChange(next[0] ?? null);
  }

  function toggle(label: string) {
    if (field.multiple) {
      commit(picked.includes(label) ? picked.filter((p) => p !== label) : [...picked, label]);
    } else {
      setOtherOpen(false);
      onChange(label);
      if (autoAdvance) setTimeout(() => onSubmit(label), 320);
    }
  }

  function setOther(text: string) {
    setOtherText(text);
    const known = picked.filter((p) => labels.has(p));
    if (field.multiple) commit(text.trim() ? [...known, text] : known);
    else onChange(text.trim() ? text : null);
  }

  useKeys(active && props.owner, (e) => {
    const i = LETTERS.indexOf(e.key.toUpperCase());
    if (e.key.length === 1 && i >= 0 && i < choices.length + (field.allowOther ? 1 : 0)) {
      e.preventDefault();
      if (i < choices.length) toggle(choices[i].label);
      else {
        setOtherOpen(true);
        setTimeout(() => otherRef.current?.focus(), 0);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  });

  const optionStyle = (on: boolean): React.CSSProperties => ({
    border: `1px solid ${on ? "var(--cf-accent)" : tint(45)}`,
    background: on ? tint(22) : tint(7),
    borderRadius: "var(--cf-radius)",
    color: "var(--cf-text)",
  });

  return (
    <div>
      {field.multiple && (
        <p className="mb-2 text-sm opacity-70">
          {field.max ? `Choose up to ${field.max}` : "Choose as many as you like"}
        </p>
      )}
      <div
        role={field.multiple ? "group" : "radiogroup"}
        aria-labelledby={`q-${field.id}`}
        className={picture ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "flex max-w-md flex-col gap-2"}
      >
        {choices.map((c, i) => {
          const on = picked.includes(c.label);
          return (
            <button
              key={c.id}
              type="button"
              role={field.multiple ? "checkbox" : "radio"}
              aria-checked={on}
              onClick={() => toggle(c.label)}
              className={`group flex text-left text-base transition hover:brightness-105 sm:text-lg ${
                picture ? "flex-col items-stretch gap-2 p-2" : "items-center gap-3 px-3 py-2"
              }`}
              style={optionStyle(on)}
            >
              {picture && (
                <span
                  className="block aspect-square w-full overflow-hidden bg-cover bg-center"
                  style={{
                    borderRadius: "calc(var(--cf-radius) * 0.7)",
                    ...(c.imageUrl ? { backgroundImage: `url("${encodeURI(c.imageUrl)}")` } : { backgroundColor: tint(15) }),
                  }}
                />
              )}
              <span className="flex items-center gap-3">
                <KeyBadge k={LETTERS[i]} on={on} />
                <span className="flex-1">{c.label}</span>
                {on && !picture && <span aria-hidden="true">✓</span>}
              </span>
            </button>
          );
        })}
        {field.allowOther && !picture && (
          <div className="flex items-center gap-3 px-3 py-2" style={optionStyle(otherOpen && !!otherText.trim())}>
            <KeyBadge k={LETTERS[choices.length]} on={otherOpen && !!otherText.trim()} />
            {otherOpen ? (
              <input
                ref={otherRef}
                className="input-reset flex-1 text-base sm:text-lg"
                style={{ color: "var(--cf-text)" }}
                value={otherText}
                placeholder="Type your answer"
                aria-label="Other"
                maxLength={500}
                onChange={(e) => setOther(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onSubmit();
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="flex-1 text-left text-base sm:text-lg"
                onClick={() => {
                  setOtherOpen(true);
                  setTimeout(() => otherRef.current?.focus(), 0);
                }}
              >
                Other
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Dropdown({ field, value, onChange, onSubmit, active, autoAdvance, owner }: InputProps) {
  const [query, setQuery] = useState(typeof value === "string" ? value : "");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (active && owner) ref.current?.focus({ preventScroll: true });
  }, [active, owner]);
  const options = (field.choices ?? []).filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));
  function pick(label: string) {
    setQuery(label);
    setOpen(false);
    onChange(label);
    if (autoAdvance) setTimeout(() => onSubmit(label), 250);
  }
  return (
    <div className="relative max-w-md">
      <input
        ref={ref}
        role="combobox"
        aria-expanded={open}
        aria-controls={`list-${field.id}`}
        aria-labelledby={`q-${field.id}`}
        className="input-reset w-full py-2 text-xl sm:text-2xl placeholder:opacity-40"
        style={textInputStyle}
        placeholder="Type or select an option"
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHi(0);
          const exact = field.choices?.find((c) => c.label.toLowerCase() === e.target.value.toLowerCase());
          onChange(exact ? exact.label : null);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHi((h) => Math.min(h + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && options[hi]) pick(options[hi].label);
            else onSubmit();
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && options.length > 0 && (
        <ul
          id={`list-${field.id}`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto p-1 shadow-lg"
          style={{ background: "var(--cf-bg)", border: `1px solid ${tint(45)}`, borderRadius: "var(--cf-radius)" }}
        >
          {options.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={value === c.label}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c.label);
              }}
              onMouseEnter={() => setHi(i)}
              className="cursor-pointer px-3 py-2"
              style={{ background: i === hi ? tint(18) : undefined, borderRadius: "calc(var(--cf-radius) * 0.6)" }}
            >
              {c.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function YesNo({ field, value, onChange, onSubmit, active, autoAdvance, owner }: InputProps) {
  const legal = field.type === "legal";
  const opts: [string, boolean, string][] = legal
    ? [["A", true, "I accept"], ["B", false, "I don't accept"]]
    : [["Y", true, "Yes"], ["N", false, "No"]];
  function pick(v: boolean) {
    onChange(v);
    if (autoAdvance) setTimeout(() => onSubmit(v), 320);
  }
  useKeys(active && owner, (e) => {
    const hit = opts.find(([k]) => k === e.key.toUpperCase());
    if (hit) {
      e.preventDefault();
      pick(hit[1]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  });
  return (
    <div role="radiogroup" aria-labelledby={`q-${field.id}`} className="flex max-w-xs flex-col gap-2">
      {opts.map(([k, v, label]) => {
        const on = value === v;
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => pick(v)}
            className="flex items-center gap-3 px-3 py-2 text-left text-lg transition hover:brightness-105"
            style={{
              border: `1px solid ${on ? "var(--cf-accent)" : tint(45)}`,
              background: on ? tint(22) : tint(7),
              borderRadius: "var(--cf-radius)",
            }}
          >
            <KeyBadge k={k} on={on} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Scale({ field, value, onChange, onSubmit, active, autoAdvance, owner }: InputProps) {
  const { start, end } = scaleRange(field);
  const values = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const stars = field.type === "rating";
  const [hover, setHover] = useState<number | null>(null);
  function pick(v: number) {
    onChange(v);
    if (autoAdvance) setTimeout(() => onSubmit(v), 320);
  }
  useKeys(active && owner, (e) => {
    if (/^[0-9]$/.test(e.key)) {
      const n = Number(e.key) === 0 && end === 10 && start === 1 ? 10 : Number(e.key);
      if (n >= start && n <= end) {
        e.preventDefault();
        pick(n);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  });
  const current = typeof value === "number" ? value : null;
  return (
    <div className="max-w-2xl">
      <div
        role="radiogroup"
        aria-labelledby={`q-${field.id}`}
        className={stars ? "flex flex-wrap gap-1" : "grid gap-1.5"}
        style={stars ? undefined : { gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}
        onMouseLeave={() => setHover(null)}
      >
        {values.map((v) => {
          const on = stars ? (hover ?? current ?? 0) >= v : current === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={current === v}
              aria-label={stars ? `${v} star${v > 1 ? "s" : ""}` : String(v)}
              onClick={() => pick(v)}
              onMouseEnter={() => setHover(v)}
              className={stars ? "p-1 text-4xl leading-none transition sm:text-5xl" : "py-3 text-lg font-semibold transition"}
              style={
                stars
                  ? { color: on ? "var(--cf-accent)" : tint(30) }
                  : {
                      border: `1px solid ${on ? "var(--cf-accent)" : tint(45)}`,
                      background: on ? "var(--cf-accent)" : tint(7),
                      color: on ? "var(--cf-btn-text)" : "var(--cf-text)",
                      borderRadius: "calc(var(--cf-radius) * 0.7)",
                    }
              }
            >
              {stars ? "★" : v}
            </button>
          );
        })}
      </div>
      {(field.labels?.left || field.labels?.right) && (
        <div className="mt-2 flex justify-between text-sm opacity-70">
          <span>{field.labels?.left}</span>
          <span>{field.labels?.right}</span>
        </div>
      )}
    </div>
  );
}

function Ranking({ field, value, onChange, onSubmit, active, owner }: InputProps) {
  const initial = Array.isArray(value) ? value : (field.choices ?? []).map((c) => c.label);
  const [order, setOrder] = useState<string[]>(initial);
  const [dragging, setDragging] = useState<number | null>(null);
  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
    onChange(next);
  }
  useKeys(active && owner, (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onChange(order);
      onSubmit(order);
    }
  });
  return (
    <div className="max-w-md">
      <p className="mb-2 text-sm opacity-70">Drag, or use the arrows. Top is #1.</p>
      <ol className="flex flex-col gap-2" aria-labelledby={`q-${field.id}`}>
        {order.map((label, i) => (
          <li
            key={label}
            draggable
            onDragStart={() => setDragging(i)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragging !== null && dragging !== i) {
                move(dragging, i);
                setDragging(i);
              }
            }}
            onDragEnd={() => setDragging(null)}
            className="flex cursor-grab items-center gap-3 px-3 py-2 text-lg"
            style={{
              border: `1px solid ${tint(45)}`,
              background: dragging === i ? tint(22) : tint(7),
              borderRadius: "var(--cf-radius)",
            }}
          >
            <span className="w-6 text-sm font-bold" style={{ color: "var(--cf-accent)" }}>
              {i + 1}
            </span>
            <span className="flex-1">{label}</span>
            <button type="button" aria-label={`Move ${label} up`} onClick={() => move(i, i - 1)} className="px-1 opacity-60 hover:opacity-100">
              ↑
            </button>
            <button type="button" aria-label={`Move ${label} down`} onClick={() => move(i, i + 1)} className="px-1 opacity-60 hover:opacity-100">
              ↓
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function FileUpload({ field, value, onChange, slug, preview }: InputProps) {
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState("");
  const file = value && typeof value === "object" && !Array.isArray(value) ? (value as FileAnswer) : null;
  async function upload(f: File) {
    setError("");
    if (preview) {
      onChange({ fileId: "preview", name: f.name, size: f.size, type: f.type });
      return;
    }
    setStatus("uploading");
    const body = new FormData();
    body.append("file", f);
    try {
      const res = await fetch(`/api/f/${slug}/upload`, { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      onChange(data as FileAnswer);
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  }
  return (
    <div className="max-w-md">
      <label
        className="flex cursor-pointer flex-col items-center justify-center gap-2 px-4 py-10 text-center transition hover:brightness-105"
        style={{ border: `2px dashed ${tint(55)}`, background: tint(6), borderRadius: "var(--cf-radius)" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) upload(f);
        }}
      >
        <span className="text-3xl" aria-hidden="true">⇪</span>
        <span className="text-base">
          {status === "uploading" ? "Uploading…" : file ? `✓ ${file.name}` : "Choose a file, or drag it here"}
        </span>
        <span className="text-xs opacity-60">{file ? `${(file.size / 1024).toFixed(0)} KB · click to replace` : "Up to 10 MB"}</span>
        <input
          type="file"
          className="sr-only"
          aria-labelledby={`q-${field.id}`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
      </label>
      {error && <p className="mt-2 text-sm" role="alert">{error}</p>}
    </div>
  );
}

export function FieldInput(props: InputProps) {
  switch (props.field.type) {
    case "multiple_choice":
    case "picture_choice":
      return <Choices {...props} autoAdvance={props.autoAdvance && !props.field.multiple} />;
    case "dropdown":
      return <Dropdown {...props} />;
    case "yes_no":
    case "legal":
      return <YesNo {...props} />;
    case "rating":
    case "opinion_scale":
    case "nps":
      return <Scale {...props} />;
    case "ranking":
      return <Ranking {...props} />;
    case "file_upload":
      return <FileUpload {...props} />;
    case "statement":
      return null;
    default:
      return <TextLike {...props} />;
  }
}
