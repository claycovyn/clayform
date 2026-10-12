"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { Player } from "@/components/player/Player";
import { lintForm } from "@/lib/engine";
import type { Form } from "@/lib/types";
import { BuildPanel } from "./BuildPanel";
import { DesignPanel } from "./DesignPanel";
import { LogicPanel } from "./LogicPanel";
import { SettingsPanel } from "./SettingsPanel";
import { SharePanel } from "./SharePanel";

export type Selection = "welcome" | `field:${string}` | `ending:${string}`;
export type Update = (fn: (form: Form) => Form) => void;

const TABS = ["Build", "Logic", "Design", "Settings", "Share"] as const;
type Tab = (typeof TABS)[number];

export function Builder({ initial, siteUrl }: { initial: Form; siteUrl: string }) {
  const [form, setForm] = useState(initial);
  const [tab, setTab] = useState<Tab>("Build");
  const [selected, setSelected] = useState<Selection>(initial.fields[0] ? `field:${initial.fields[0].id}` : "welcome");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [save, setSave] = useState<{ state: "saved" | "saving" | "error"; message?: string }>({ state: "saved" });
  const [problemsOpen, setProblemsOpen] = useState(false);

  // Undo / redo. Rapid edits (typing) are grouped into one step.
  const past = useRef<Form[]>([]);
  const future = useRef<Form[]>([]);
  const lastPush = useRef(0);
  const formRef = useRef(form);
  formRef.current = form;

  const update: Update = useCallback((fn) => {
    const prev = formRef.current;
    const next = fn(prev);
    if (next === prev) return;
    const now = Date.now();
    if (now - lastPush.current > 700) {
      past.current = [...past.current.slice(-99), prev];
      future.current = [];
    }
    lastPush.current = now;
    setForm(next);
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(formRef.current);
    lastPush.current = 0;
    setForm(prev);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(formRef.current);
    lastPush.current = 0;
    setForm(next);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Autosave.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSave({ state: "saving" });
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/forms/${form.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) setSave({ state: "error", message: data.error });
        else setSave({ state: "saved" });
      } catch {
        setSave({ state: "error", message: "Couldn't reach the server." });
      }
    }, 700);
    return () => clearTimeout(t);
  }, [form]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save.state !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.state]);

  const problems = lintForm(form);
  const published = form.status === "published";

  function togglePublish() {
    if (!published && problems.length) {
      setProblemsOpen(true);
      return;
    }
    update((f) => ({ ...f, status: published ? "draft" : "published" }));
  }

  const focus =
    selected === "welcome"
      ? "welcome"
      : selected.startsWith("ending:")
        ? selected
        : form.fields.find((f) => `field:${f.id}` === selected)?.ref;
  const showPreview = tab === "Build" || tab === "Design";

  return (
    <div className="flex h-[100dvh] flex-col bg-sand/50">
      <header className="flex flex-wrap items-center gap-3 border-b border-ink/10 bg-white px-3 py-2">
        <Link href="/forms" className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-sand" title="All forms">
          <LogoMark size={28} />
          <span className="sr-only">All forms</span>
        </Link>
        <input
          aria-label="Form name"
          className="min-w-0 max-w-[16rem] flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold outline-none hover:bg-sand focus:bg-sand"
          value={form.title}
          onChange={(e) => update((f) => ({ ...f, title: e.target.value }))}
        />
        <nav className="order-last flex w-full gap-1 overflow-x-auto md:order-none md:w-auto" aria-label="Builder sections">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === t ? "bg-ink text-cream" : "text-ink-soft hover:bg-sand"}`}
            >
              {t}
            </button>
          ))}
          <Link href={`/forms/${form.id}/results`} className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-sand">
            Results
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-1 sm:flex">
            <button type="button" className="btn-ghost px-2" onClick={undo} title="Undo (Ctrl/⌘ Z)" aria-label="Undo">
              ↶
            </button>
            <button type="button" className="btn-ghost px-2" onClick={redo} title="Redo (Ctrl/⌘ ⇧ Z)" aria-label="Redo">
              ↷
            </button>
          </div>
          <span className={`text-xs ${save.state === "error" ? "font-semibold text-red-600" : "text-ink-soft"}`} role="status">
            {save.state === "saving" ? "Saving…" : save.state === "error" ? save.message || "Not saved" : "Saved"}
          </span>
          <a href={`/f/${form.slug}`} target="_blank" rel="noopener" className="btn-outline">
            Open ↗
          </a>
          <button type="button" onClick={togglePublish} className={published ? "btn-outline" : "btn-clay"}>
            {published ? "Unpublish" : "Publish"}
          </button>
        </div>
      </header>

      {problemsOpen && problems.length > 0 && (
        <div className="border-b border-clay/30 bg-clay-light/40 px-4 py-3 text-sm" role="alert">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold">Fix these before publishing:</p>
              <ul className="mt-1 list-disc pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
            <button type="button" className="btn-ghost" onClick={() => setProblemsOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {tab === "Build" && <BuildPanel form={form} update={update} selected={selected} setSelected={setSelected} />}
        {tab === "Logic" && <LogicPanel form={form} update={update} />}
        {tab === "Design" && <DesignPanel form={form} update={update} />}
        {tab === "Settings" && <SettingsPanel form={form} update={update} />}
        {tab === "Share" && <SharePanel form={form} update={update} siteUrl={siteUrl} />}

        {showPreview && (
          <div className="order-2 hidden min-w-0 flex-1 flex-col p-4 lg:flex">
            <div className="mb-2 flex items-center justify-between text-xs text-ink-soft">
              <span>Live preview — answers aren&apos;t saved</span>
              <div className="flex gap-1 rounded-lg bg-white p-0.5">
                {(["desktop", "mobile"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDevice(d)}
                    className={`rounded-md px-2 py-1 capitalize ${device === d ? "bg-ink text-cream" : ""}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div
              className={`relative mx-auto w-full flex-1 overflow-hidden rounded-2xl border border-ink/10 shadow-sm transition-all ${
                device === "mobile" ? "max-w-[390px]" : ""
              }`}
            >
              <Player key={`${focus}-${form.settings.mode}`} form={form} preview contained focus={focus} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
