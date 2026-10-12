"use client";

import { useState } from "react";
import type { Form, FormSettings } from "@/lib/types";
import type { Update } from "./Builder";
import { Labeled, NumberField, opt, Section, TextField, Toggle } from "./ui";

export function SettingsPanel({ form, update }: { form: Form; update: Update }) {
  const s = form.settings;
  const set = (patch: Partial<FormSettings>) => update((f) => ({ ...f, settings: { ...f.settings, ...patch } }));
  const [hiddenDraft, setHiddenDraft] = useState("");
  const [test, setTest] = useState<string>("");

  async function testWebhook() {
    setTest("Sending…");
    try {
      const res = await fetch(`/api/forms/${form.id}/webhook-test`, { method: "POST" });
      const data = await res.json();
      setTest(data.error ? data.error : data.ok ? `Delivered (HTTP ${data.status}).` : `Failed${data.status ? ` (HTTP ${data.status})` : ""}: ${data.error ?? "endpoint didn't accept it"}`);
    } catch {
      setTest("Couldn't reach the server.");
    }
  }

  return (
    <div className="order-1 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl p-4 sm:p-8">
        <h2 className="font-display text-2xl font-bold">Settings</h2>
        <div className="card mt-6 overflow-hidden">
          <Section title="Layout">
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["conversational", "One at a time", "Each question gets the whole screen. Higher completion."],
                  ["classic", "All on one page", "A classic scrolling form. Faster for long, simple forms."],
                ] as const
              ).map(([mode, title, hint]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => set({ mode })}
                  className={`rounded-xl border p-3 text-left transition ${s.mode === mode ? "border-clay bg-clay/5 ring-2 ring-clay/20" : "border-ink/10 hover:border-ink/30"}`}
                >
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block text-xs text-ink-soft">{hint}</span>
                </button>
              ))}
            </div>
            <Toggle label="Progress bar" checked={s.showProgress} onChange={(v) => set({ showProgress: v })} />
            <Toggle label="Question numbers" checked={s.showQuestionNumbers} onChange={(v) => set({ showQuestionNumbers: v })} />
            <Toggle
              label="Save & resume"
              hint="Answers save as people go. They can close the tab and pick up later, or copy a link to finish on another device."
              checked={s.allowResume}
              onChange={(v) => set({ allowResume: v })}
            />
            <Toggle label="“Made with Clayform” badge" hint="Off by default. Your form, your brand." checked={s.branding} onChange={(v) => set({ branding: v })} />
          </Section>

          <Section title="Accepting responses">
            <Toggle label="Close this form now" checked={s.closed} onChange={(v) => set({ closed: v })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Labeled label="Close automatically on">
                <input
                  type="datetime-local"
                  className="field"
                  value={s.closeAt ? s.closeAt.slice(0, 16) : ""}
                  onChange={(e) => set({ closeAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
                />
              </Labeled>
              <Labeled label="Stop after N responses" hint="Leave blank for unlimited. It's your server — there is no cap.">
                <NumberField value={s.responseLimit} min={1} onChange={(v) => set({ responseLimit: v && v > 0 ? Math.floor(v) : undefined })} placeholder="Unlimited" />
              </Labeled>
            </div>
            <Labeled label="Message when closed">
              <TextField value={s.closedMessage} onChange={(v) => set({ closedMessage: v })} />
            </Labeled>
          </Section>

          <Section title="Hidden fields">
            <p className="text-xs text-ink-soft">
              Pass data in the link, like <code className="rounded bg-sand px-1">?source=newsletter</code>. Saved with each response, usable in logic and recall.
            </p>
            <div className="flex flex-wrap gap-2">
              {form.hiddenFields.map((h) => (
                <span key={h} className="inline-flex items-center gap-1 rounded-full bg-sand px-2.5 py-1 font-mono text-xs">
                  {h}
                  <button type="button" aria-label={`Remove ${h}`} className="text-ink-soft hover:text-red-600" onClick={() => update((f) => ({ ...f, hiddenFields: f.hiddenFields.filter((x) => x !== h) }))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const key = hiddenDraft.trim();
                if (!/^[A-Za-z0-9_-]{1,40}$/.test(key) || form.hiddenFields.includes(key) || form.fields.some((f) => f.ref === key)) return;
                update((f) => ({ ...f, hiddenFields: [...f.hiddenFields, key] }));
                setHiddenDraft("");
              }}
            >
              <input className="field font-mono" placeholder="e.g. utm_source" value={hiddenDraft} onChange={(e) => setHiddenDraft(e.target.value)} />
              <button type="submit" className="btn-outline">
                Add
              </button>
            </form>
          </Section>

          <Section title="Webhook">
            <p className="text-xs text-ink-soft">
              We POST every completed response as JSON. Connect Zapier, Make, n8n, Slack, your CRM or your own code. With a secret, each request carries an{" "}
              <code className="rounded bg-sand px-1">X-Clayform-Signature: sha256=…</code> HMAC header.
            </p>
            <Labeled label="URL">
              <TextField value={s.webhookUrl} onChange={(v) => set({ webhookUrl: opt(v) })} placeholder="https://hooks.example.com/…" />
            </Labeled>
            <Labeled label="Signing secret (optional)">
              <TextField value={s.webhookSecret} onChange={(v) => set({ webhookSecret: opt(v) })} />
            </Labeled>
            <div className="flex items-center gap-3">
              <button type="button" className="btn-outline" onClick={testWebhook} disabled={!s.webhookUrl}>
                Send a test
              </button>
              {test && <span className="text-xs text-ink-soft" role="status">{test}</span>}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
