"use client";

import { useState } from "react";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card space-y-4 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        });
        setBusy(false);
        if (res.ok) window.location.href = "/forms";
        else setError((await res.json().catch(() => ({}))).error || "Couldn't sign in.");
      }}
    >
      <label className="block">
        <span className="label">Password</span>
        <input className="field" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <button type="submit" className="btn-brand w-full" disabled={busy || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
