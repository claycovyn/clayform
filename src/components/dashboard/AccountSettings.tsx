"use client";

import { useState } from "react";

type Status = { kind: "ok" | "error"; message: string } | null;

async function send(method: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/account", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { ok: false, error: data.error || "Something went wrong." };
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}

function Note({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p role={status.kind === "error" ? "alert" : "status"} className={`text-sm ${status.kind === "error" ? "text-red-600" : "text-emerald-700"}`}>
      {status.message}
    </p>
  );
}

export function AccountSettings({ name: initialName }: { name: string }) {
  const [name, setName] = useState(initialName);
  const [nameStatus, setNameStatus] = useState<Status>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwStatus, setPwStatus] = useState<Status>(null);
  const [del, setDel] = useState({ open: false, password: "" });
  const [delStatus, setDelStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <div className="mt-8 space-y-6">
      <form
        className="card space-y-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy("name");
          const r = await send("PATCH", { name });
          setBusy(null);
          setNameStatus(r.ok ? { kind: "ok", message: "Saved." } : { kind: "error", message: r.error! });
        }}
      >
        <h2 className="font-semibold">Name</h2>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" aria-label="Name" />
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={busy === "name" || !name.trim()}>
            Save
          </button>
          <Note status={nameStatus} />
        </div>
      </form>

      <form
        className="card space-y-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy("pw");
          const r = await send("PATCH", { currentPassword: pw.current, newPassword: pw.next });
          setBusy(null);
          if (r.ok) setPw({ current: "", next: "" });
          setPwStatus(r.ok ? { kind: "ok", message: "Password changed. Other devices are signed out." } : { kind: "error", message: r.error! });
        }}
      >
        <h2 className="font-semibold">Password</h2>
        <label className="block">
          <span className="label">Current password</span>
          <input className="field" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">New password</span>
          <input className="field" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          <span className="mt-1 block text-xs text-ink-soft">At least 8 characters.</span>
        </label>
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={busy === "pw" || !pw.current || !pw.next}>
            Change password
          </button>
          <Note status={pwStatus} />
        </div>
      </form>

      <div className="card flex items-center justify-between gap-3 p-5">
        <div>
          <h2 className="font-semibold">Log out</h2>
          <p className="text-sm text-ink-soft">On this device.</p>
        </div>
        <button
          type="button"
          className="btn-outline"
          onClick={async () => {
            await fetch("/api/logout", { method: "POST" });
            window.location.href = "/";
          }}
        >
          Log out
        </button>
      </div>

      <div className="card space-y-3 border-red-200 p-5">
        <h2 className="font-semibold text-red-700">Delete account</h2>
        <p className="text-sm text-ink-soft">Deletes your account, every form, every response and every uploaded file. This can&apos;t be undone.</p>
        {del.open ? (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy("del");
              const r = await send("DELETE", { password: del.password });
              setBusy(null);
              if (r.ok) window.location.href = "/";
              else setDelStatus({ kind: "error", message: r.error! });
            }}
          >
            <label className="block">
              <span className="label">Type your password to confirm</span>
              <input className="field" type="password" autoComplete="current-password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="btn bg-red-600 text-white hover:bg-red-700" disabled={busy === "del" || !del.password}>
                Delete everything
              </button>
              <button type="button" className="btn-ghost" onClick={() => setDel({ open: false, password: "" })}>
                Cancel
              </button>
              <Note status={delStatus} />
            </div>
          </form>
        ) : (
          <button type="button" className="btn-outline text-red-600" onClick={() => setDel({ open: true, password: "" })}>
            Delete my account…
          </button>
        )}
      </div>
    </div>
  );
}
