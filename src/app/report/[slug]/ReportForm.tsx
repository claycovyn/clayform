"use client";

import { useState } from "react";

export function ReportForm({ slug, reasons }: { slug: string; reasons: Record<string, string> }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "done" } | { kind: "error"; message: string }>({ kind: "idle" });
  if (state.kind === "done")
    return (
      <p role="status" className="card mt-6 p-5">
        Thanks. Someone at Clayform will look at this form. If it&apos;s asking you for a password or payment details, don&apos;t enter them.
      </p>
    );
  return (
    <form
      className="card mt-6 space-y-4 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setState({ kind: "sending" });
        const res = await fetch(`/api/f/${slug}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason, details }) });
        const data = await res.json().catch(() => ({}));
        setState(res.ok ? { kind: "done" } : { kind: "error", message: data.error || "Couldn't send the report." });
      }}
    >
      <fieldset>
        <legend className="label">What's wrong?</legend>
        <div className="space-y-2">
          {Object.entries(reasons).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="radio" name="reason" value={k} checked={reason === k} onChange={() => setReason(k)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="label">Anything else? (optional)</span>
        <textarea className="field min-h-[90px]" maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={!reason || state.kind === "sending"}>
          Send report
        </button>
        {state.kind === "error" && (
          <p role="alert" className="text-sm text-red-600">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
