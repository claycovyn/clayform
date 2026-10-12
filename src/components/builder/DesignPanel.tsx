"use client";

import { FONT_STACKS, THEME_PRESETS } from "@/lib/fields";
import type { Form, Theme } from "@/lib/types";
import type { Update } from "./Builder";
import { Labeled, opt, Section, TextField } from "./ui";

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input
          className="field w-24 py-1 font-mono text-xs"
          value={value}
          onChange={(e) => /^#[0-9a-fA-F]{0,8}$/.test(e.target.value) && onChange(e.target.value)}
          aria-label={`${label} hex`}
        />
        <input type="color" value={value.length === 7 ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="h-8 w-8 cursor-pointer rounded border border-ink/10" aria-label={label} />
      </span>
    </label>
  );
}

export function DesignPanel({ form, update }: { form: Form; update: Update }) {
  const t = form.theme;
  const set = (patch: Partial<Theme>) => update((f) => ({ ...f, theme: { ...f.theme, ...patch, preset: patch.preset ?? "Custom" } }));
  const textContrast = /^#[0-9a-f]{6}$/i.test(t.bg) && /^#[0-9a-f]{6}$/i.test(t.text) ? contrast(t.bg, t.text) : 21;
  const buttonContrast = /^#[0-9a-f]{6}$/i.test(t.accent) && /^#[0-9a-f]{6}$/i.test(t.buttonText) ? contrast(t.accent, t.buttonText) : 21;

  return (
    <aside className="order-1 w-full shrink-0 overflow-y-auto border-r border-ink/10 bg-white lg:w-80">
      <Section title="Themes">
        <div className="grid grid-cols-2 gap-2">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.preset}
              type="button"
              onClick={() => update((f) => ({ ...f, theme: { ...p, backgroundImage: f.theme.backgroundImage } }))}
              className={`overflow-hidden rounded-xl border text-left transition ${t.preset === p.preset ? "border-clay ring-2 ring-clay/30" : "border-ink/10 hover:border-ink/30"}`}
            >
              <div className="p-3" style={{ background: p.bg, color: p.text, fontFamily: FONT_STACKS[p.font] }}>
                <div className="text-sm font-semibold">Question?</div>
                <div className="mt-2 inline-block px-2 py-0.5 text-xs font-semibold" style={{ background: p.accent, color: p.buttonText, borderRadius: Math.min(p.radius, 10) }}>
                  OK ✓
                </div>
              </div>
              <div className="px-3 py-1.5 text-xs font-medium">{p.preset}</div>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Colours">
        <Color label="Background" value={t.bg} onChange={(v) => set({ bg: v })} />
        <Color label="Text" value={t.text} onChange={(v) => set({ text: v })} />
        <Color label="Accent / buttons" value={t.accent} onChange={(v) => set({ accent: v })} />
        <Color label="Button text" value={t.buttonText} onChange={(v) => set({ buttonText: v })} />
        {(textContrast < 4.5 || buttonContrast < 3) && (
          <p className="rounded-lg bg-clay-light/40 p-2 text-xs" role="alert">
            ⚠ Low contrast ({(textContrast < 4.5 ? textContrast : buttonContrast).toFixed(1)}:1). Some people won&apos;t be able to read this. Aim for 4.5:1 for text.
          </p>
        )}
      </Section>
      <Section title="Type & shape">
        <Labeled label="Font">
          <select className="field" value={t.font} onChange={(e) => set({ font: e.target.value as Theme["font"] })}>
            <option value="sans">Clean (Inter)</option>
            <option value="serif">Editorial (Fraunces)</option>
            <option value="rounded">Friendly (Nunito)</option>
            <option value="display">Bold (Space Grotesk)</option>
            <option value="mono">Mono (JetBrains Mono)</option>
          </select>
        </Labeled>
        <Labeled label={`Corner radius · ${t.radius}px`}>
          <input type="range" min={0} max={32} value={t.radius} onChange={(e) => set({ radius: Number(e.target.value) })} className="w-full accent-[#D4683F]" />
        </Labeled>
        <Labeled label="Welcome & ending alignment">
          <select className="field" value={t.align} onChange={(e) => set({ align: e.target.value as Theme["align"] })}>
            <option value="left">Left</option>
            <option value="center">Centre</option>
          </select>
        </Labeled>
        <Labeled label="Background image URL" hint="Tinted with your background colour so text stays readable.">
          <TextField value={t.backgroundImage} onChange={(v) => set({ backgroundImage: opt(v) })} placeholder="https://…" />
        </Labeled>
      </Section>
    </aside>
  );
}
