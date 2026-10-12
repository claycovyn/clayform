"use client";

import { useId } from "react";

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && <p className="text-xs text-ink-soft">{hint}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} className="toggle mt-0.5" onClick={() => onChange(!checked)}>
        <span />
      </button>
    </div>
  );
}

export function Labeled({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  multiline,
  type = "text",
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  type?: string;
}) {
  return multiline ? (
    <textarea className="field min-h-[72px] resize-y" value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input className="field" type={type} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

export function NumberField({
  value,
  onChange,
  placeholder,
  min,
  max,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
}) {
  return (
    <input
      className="field"
      type="number"
      min={min}
      max={max}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
    />
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-ink/10 px-4 py-4 last:border-0">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-soft">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Empty strings become undefined so optional fields stay optional. */
export const opt = (v: string) => (v.trim() === "" ? undefined : v);
