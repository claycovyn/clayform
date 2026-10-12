"use client";

import { useEffect, useState } from "react";

type Key = { id: string; name: string; prefix: string; scopes: string[]; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never");

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-outline shrink-0"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** API keys for AI agents and scripts, plus how to connect an agent over MCP. */
export function ApiKeys({ scopes, defaults, mcpUrl }: { scopes: Record<string, string>; defaults: string[]; mcpUrl: string }) {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>(defaults);
  const [fresh, setFresh] = useState<{ name: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch("/api/account/keys", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setKeys(data.keys);
    else setError(data.error || "Couldn't load your keys.");
  };
  useEffect(() => {
    void load();
  }, []);

  const active = keys?.filter((k) => !k.revokedAt) ?? [];

  return (
    <section className="card space-y-5 p-5" aria-labelledby="api-keys">
      <div>
        <h2 id="api-keys" className="font-semibold">AI agents and API keys</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Let an AI assistant (Grok, Claude, ChatGPT…) build forms, publish them and read your results for you. Create a key, then add Clayform to the
          assistant as a custom MCP server.
        </p>
      </div>

      <div className="rounded-xl bg-mist/60 p-4 text-sm">
        <p className="label">Connect an agent</p>
        <dl className="space-y-2">
          <div>
            <dt className="text-ink-soft">Server URL</dt>
            <dd className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-xs">{mcpUrl}</code>
              <Copy text={mcpUrl} />
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">Header</dt>
            <dd className="mt-1">
              <code className="block rounded-lg bg-white px-3 py-2 font-mono text-xs">Authorization: Bearer cf_…your key…</code>
            </dd>
          </div>
        </dl>
      </div>

      {fresh && (
        <div className="rounded-xl border-2 border-brand/40 bg-brand/5 p-4" role="status">
          <p className="font-semibold">Your new key “{fresh.name}”</p>
          <p className="mt-1 text-sm text-ink-soft">Copy it now. For your safety it won&apos;t be shown again.</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs">{fresh.secret}</code>
            <Copy text={fresh.secret} />
          </div>
          <button type="button" className="btn-ghost mt-2 -ml-3 text-sm" onClick={() => setFresh(null)}>
            I&apos;ve saved it
          </button>
        </div>
      )}

      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const res = await fetch("/api/account/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, scopes: picked }) });
          const data = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) return setError(data.error || "Couldn't create the key.");
          setFresh({ name: data.key.name, secret: data.secret });
          setName("");
          setPicked(defaults);
          void load();
        }}
      >
        <label className="block">
          <span className="label">New key name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Grok Bot" />
        </label>
        <fieldset>
          <legend className="label">It can</legend>
          <div className="space-y-1.5">
            {Object.entries(scopes).map(([scope, label]) => (
              <label key={scope} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={picked.includes(scope)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, scope] : picked.filter((s) => s !== scope))}
                />
                <span>
                  {label} <span className="font-mono text-xs text-ink-soft">{scope}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={busy || !name.trim() || !picked.length}>
            Create key
          </button>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
      </form>

      <div>
        <p className="label">Your keys</p>
        {keys === null ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : active.length === 0 ? (
          <p className="text-sm text-ink-soft">No keys yet.</p>
        ) : (
          <ul className="divide-y divide-ink/10 rounded-xl border border-ink/10">
            {active.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{k.name}</p>
                  <p className="text-xs text-ink-soft">
                    <span className="font-mono">{k.prefix}…</span> · created {when(k.createdAt)} · last used {when(k.lastUsedAt)}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-soft">{k.scopes.join(" · ")}</p>
                </div>
                <button
                  type="button"
                  className="btn-outline text-red-600"
                  onClick={async () => {
                    if (!confirm(`Revoke “${k.name}”? Anything using it stops working right away.`)) return;
                    const res = await fetch(`/api/account/keys/${k.id}`, { method: "DELETE" });
                    if (!res.ok) setError("Couldn't revoke that key.");
                    void load();
                  }}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
