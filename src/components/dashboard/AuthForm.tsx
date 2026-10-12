"use client";

import Link from "next/link";
import { useState } from "react";

type Mode = "signup" | "login";

export function AuthForm({ mode }: { mode: Mode }) {
  const [values, setValues] = useState({ name: "", email: "", password: "", website: "" });
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const signup = mode === "signup";
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const bad = (field: string) => (error?.field === field ? "border-red-500" : "");

  return (
    <form
      className="card space-y-4 p-5 sm:p-6"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const res = await fetch(signup ? "/api/signup" : "/api/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(signup ? values : { email: values.email, password: values.password }),
          });
          if (res.ok) {
            window.location.href = "/forms";
            return;
          }
          const data = await res.json().catch(() => ({}));
          setError({ message: data.error || "Something went wrong. Try again.", field: data.field });
        } catch {
          setError({ message: "Couldn't reach the server. Check your connection." });
        }
        setBusy(false);
      }}
    >
      {signup && (
        <label className="block">
          <span className="label">Your name</span>
          <input className={`field ${bad("name")}`} autoComplete="name" autoFocus value={values.name} onChange={set("name")} maxLength={80} />
        </label>
      )}
      <label className="block">
        <span className="label">Email</span>
        <input
          className={`field ${bad("email")}`}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus={!signup}
          value={values.email}
          onChange={set("email")}
        />
      </label>
      <div>
        <label htmlFor="cf-password" className="label">
          Password
        </label>
        <div className="relative">
          <input
            id="cf-password"
            className={`field pr-16 ${bad("password")}`}
            type={show ? "text" : "password"}
            autoComplete={signup ? "new-password" : "current-password"}
            value={values.password}
            onChange={set("password")}
            maxLength={200}
            aria-describedby={signup ? "cf-password-hint" : undefined}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-ink-soft hover:text-ink"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>
        {signup && (
          <span id="cf-password-hint" className="mt-1 block text-xs text-ink-soft">
            At least 8 characters.
          </span>
        )}
      </div>
      {/* Honeypot for bots: hidden from people and screen readers. */}
      {signup && (
        <input
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute -left-[9999px] h-px w-px opacity-0"
          name="website"
          value={values.website}
          onChange={set("website")}
        />
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error.message}
        </p>
      )}
      <button type="submit" className="btn-brand w-full py-3 text-base" disabled={busy}>
        {busy ? (signup ? "Creating your account…" : "Logging in…") : signup ? "Create free account" : "Log in"}
      </button>
      <p className="text-center text-sm text-ink-soft">
        {signup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-brand hover:underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="font-semibold text-brand hover:underline">
              Create a free account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
