"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeScore,
  fieldByRef,
  firstStep,
  isEmpty,
  isQuestion,
  nextStep,
  pickEnding,
  recall,
  resolvePath,
  validateAnswer,
} from "@/lib/engine";
import { FONT_STACKS } from "@/lib/fields";
import type { AnswerValue, Answers, Ctx, Field, Form } from "@/lib/types";
import { FieldInput } from "./FieldInput";

type Screen =
  | { kind: "welcome" }
  | { kind: "field"; ref: string }
  | { kind: "ending"; id: string }
  | { kind: "resume" }
  | { kind: "closed"; message: string };

export interface PlayerProps {
  form: Form;
  /** Builder preview: nothing is saved. */
  preview?: boolean;
  /** Fill the parent instead of the viewport. */
  contained?: boolean;
  embedded?: boolean;
  initialHidden?: Record<string, string>;
  /** "welcome", a field ref, or "ending:<id>" — which screen to open on. */
  focus?: string;
  resumeParam?: string;
  closedMessage?: string | null;
  /** Hosted Cloud only: where respondents report abuse. */
  reportUrl?: string;
  maxUploadMb?: number;
}

interface Creds {
  id: string;
  token: string;
}

interface SyncResult {
  ok: boolean;
  offline?: boolean;
  endingId?: string;
  error?: string;
  ref?: string;
}

const store = {
  get<T>(key: string): T | null {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  del(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

function initialScreen(form: Form, focus: string | undefined, ctx: Ctx, closedMessage?: string | null): Screen {
  if (closedMessage) return { kind: "closed", message: closedMessage };
  if (focus?.startsWith("ending:")) return { kind: "ending", id: focus.slice(7) };
  if (focus && focus !== "welcome" && fieldByRef(form, focus)) return { kind: "field", ref: focus };
  if (form.welcome.enabled && (focus === "welcome" || !focus)) return { kind: "welcome" };
  const step = firstStep(form, ctx);
  return step.kind === "field" ? { kind: "field", ref: step.ref } : { kind: "ending", id: step.id };
}

export function Player({ form, preview = false, contained = false, embedded = false, initialHidden = {}, focus, resumeParam, closedMessage, maxUploadMb = 10, reportUrl }: PlayerProps) {
  const hidden = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of form.hiddenFields) if (initialHidden[key]) out[key] = initialHidden[key];
    return out;
  }, [form.hiddenFields, initialHidden]);

  const [answers, setAnswersState] = useState<Answers>({});
  const answersRef = useRef<Answers>({});
  const cleared = useRef(new Set<string>());
  const setAnswers = useCallback((next: Answers) => {
    answersRef.current = next;
    setAnswersState(next);
  }, []);

  const score = computeScore(form, answers);
  const ctx: Ctx = { answers, hidden, score };
  const path = resolvePath(form, ctx);

  const [screen, setScreen] = useState<Screen>(() => initialScreen(form, focus, ctx, closedMessage));
  const [history, setHistory] = useState<string[]>([]);
  const [dir, setDir] = useState<"up" | "down">("up");
  const [error, setError] = useState<{ ref: string; message: string; n: number } | null>(null);
  const [classicErrors, setClassicErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Resume link shown in the form's own theme when the clipboard is blocked. */
  const [manualLink, setManualLink] = useState<string | null>(null);
  const manualLinkRef = useRef<HTMLInputElement>(null);
  const finishLaterRef = useRef<HTMLButtonElement>(null);
  const [resumeData, setResumeData] = useState<{ creds: Creds; answers: Answers; lastRef?: string } | null>(null);

  const creds = useRef<Creds | null>(null);
  const startedAt = useRef(new Date().toISOString());
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const key = `clayform:${form.slug}`;
  const outboxKey = `clayform:outbox:${form.slug}`;
  const classic = form.settings.mode === "classic";

  // ---- saving -------------------------------------------------------------

  const post = useCallback(
    async (payload: Record<string, unknown>): Promise<SyncResult> => {
      try {
        const res = await fetch(`/api/f/${form.slug}/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: data.error || "Something went wrong. Try again.", ref: data.ref };
        if (data.resumeToken) {
          creds.current = { id: data.responseId, token: data.resumeToken };
          if (form.settings.allowResume) store.set(key, creds.current);
        }
        setOffline(false);
        return { ok: true, endingId: data.endingId };
      } catch {
        return { ok: false, offline: true };
      }
    },
    [form.slug, form.settings.allowResume, key],
  );

  const sync = useCallback(
    (complete: boolean, lastRef?: string): Promise<SyncResult> => {
      if (preview) return Promise.resolve({ ok: true });
      const run = async (): Promise<SyncResult> => {
        const sent: Record<string, AnswerValue> = { ...answersRef.current };
        for (const ref of cleared.current) if (!(ref in sent)) sent[ref] = null;
        const payload = {
          responseId: creds.current?.id,
          resumeToken: creds.current?.token,
          answers: sent,
          hidden,
          lastRef,
          complete,
          startedAt: startedAt.current,
          website: "",
        };
        const result = await post(payload);
        if (result.offline) {
          setOffline(true);
          if (complete) {
            store.set(outboxKey, payload);
            return { ok: true, offline: true };
          }
        }
        if (result.ok) cleared.current.clear();
        if (result.ok && complete) store.del(key);
        return result;
      };
      const next = chain.current.then(run, run);
      chain.current = next;
      return next;
    },
    [preview, hidden, post, key, outboxKey],
  );

  // Send anything that was finished while offline.
  useEffect(() => {
    if (preview) return;
    const flush = async () => {
      const pending = store.get<Record<string, unknown>>(outboxKey);
      if (!pending) return;
      const result = await post(pending);
      if (result.ok || !result.offline) store.del(outboxKey);
    };
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [preview, outboxKey, post]);

  // Count the view, and offer to resume an unfinished response.
  useEffect(() => {
    if (preview || closedMessage) return;
    fetch(`/api/f/${form.slug}/view`, { method: "POST", keepalive: true }).catch(() => {});
    if (!form.settings.allowResume) return;
    let saved: Creds | null = null;
    if (resumeParam && resumeParam.includes(".")) {
      const [id, token] = resumeParam.split(".");
      saved = { id, token };
    } else saved = store.get<Creds>(key);
    if (!saved) return;
    const c = saved;
    fetch(`/api/f/${form.slug}/resume?id=${encodeURIComponent(c.id)}&token=${encodeURIComponent(c.token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || data.completed) {
          store.del(key);
          return;
        }
        if (Object.keys(data.answers ?? {}).length === 0) {
          creds.current = c;
          return;
        }
        setResumeData({ creds: c, answers: data.answers, lastRef: data.lastRef });
        setScreen({ kind: "resume" });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Classic mode: save partial answers a moment after typing stops.
  useEffect(() => {
    if (!classic || preview || Object.keys(answers).length === 0) return;
    const t = setTimeout(() => sync(false), 1500);
    return () => clearTimeout(t);
  }, [answers, classic, preview, sync]);

  // ---- navigation ---------------------------------------------------------

  function updateAnswer(ref: string, value: AnswerValue) {
    const next = { ...answersRef.current };
    if (isEmpty(value)) {
      delete next[ref];
      cleared.current.add(ref);
    } else {
      next[ref] = value;
      cleared.current.delete(ref);
    }
    setAnswers(next);
    if (error?.ref === ref) setError(null);
    if (classicErrors[ref]) setClassicErrors((e) => ({ ...e, [ref]: "" }));
  }

  function notifyParent(endingId: string) {
    if (!embedded || typeof window === "undefined" || window.parent === window) return;
    window.parent.postMessage({ type: "clayform:submit", slug: form.slug, responseId: creds.current?.id, endingId }, "*");
  }

  async function finish(fallbackEnding: string) {
    setBusy(true);
    const result = await sync(true);
    setBusy(false);
    if (!result.ok) {
      if (result.ref && fieldByRef(form, result.ref)) {
        if (classic) setClassicErrors({ [result.ref]: result.error ?? "Check this answer." });
        else {
          setScreen({ kind: "field", ref: result.ref });
          setError({ ref: result.ref, message: result.error ?? "Check this answer.", n: Date.now() });
        }
      } else {
        setError({ ref: "_", message: result.error ?? "Couldn't send. Try again.", n: Date.now() });
      }
      return;
    }
    const endingId = result.endingId ?? fallbackEnding;
    setDir("up");
    setScreen({ kind: "ending", id: endingId });
    notifyParent(endingId);
  }

  function goNext(override?: AnswerValue) {
    if (screen.kind === "welcome") {
      const step = firstStep(form, { answers: answersRef.current, hidden, score });
      setDir("up");
      if (step.kind === "field") setScreen({ kind: "field", ref: step.ref });
      else finish(step.id);
      return;
    }
    if (screen.kind !== "field" || busy) return;
    const field = fieldByRef(form, screen.ref);
    if (!field) return;
    let current = answersRef.current;
    if (override !== undefined) {
      current = { ...current, [field.ref]: override };
      setAnswers(current);
    }
    const message = validateAnswer(field, current[field.ref]);
    if (message) {
      setError({ ref: field.ref, message, n: Date.now() });
      return;
    }
    setError(null);
    const live: Ctx = { answers: current, hidden, score: computeScore(form, current) };
    const step = nextStep(form, field.ref, live);
    if (step.kind === "field") {
      setHistory((h) => [...h, field.ref]);
      setDir("up");
      setScreen({ kind: "field", ref: step.ref });
      if (isQuestion(field)) sync(false, step.ref);
    } else {
      finish(step.id);
    }
  }

  function goBack() {
    if (screen.kind !== "field") return;
    const prev = history[history.length - 1];
    setError(null);
    if (!prev) {
      if (form.welcome.enabled) {
        setDir("down");
        setScreen({ kind: "welcome" });
      }
      return;
    }
    setHistory((h) => h.slice(0, -1));
    setDir("down");
    setScreen({ kind: "field", ref: prev });
  }

  function continueResume() {
    if (!resumeData) return;
    creds.current = resumeData.creds;
    setAnswers(resumeData.answers);
    const live: Ctx = { answers: resumeData.answers, hidden, score: computeScore(form, resumeData.answers) };
    const p = resolvePath(form, live);
    const target =
      p.refs.find((ref) => {
        const f = fieldByRef(form, ref)!;
        return isQuestion(f) && (isEmpty(resumeData.answers[ref]) || validateAnswer(f, resumeData.answers[ref]));
      }) ?? p.refs[p.refs.length - 1];
    setHistory(p.refs.slice(0, Math.max(p.refs.indexOf(target), 0)));
    setDir("up");
    if (classic) setScreen({ kind: "welcome" });
    else if (target) setScreen({ kind: "field", ref: target });
    setResumeData(null);
  }

  function startOver() {
    store.del(key);
    creds.current = null;
    setResumeData(null);
    setAnswers({});
    setHistory([]);
    setScreen(initialScreen(form, undefined, { answers: {}, hidden, score: 0 }));
  }

  async function copyResumeLink() {
    if (!creds.current) await sync(false);
    if (!creds.current) return;
    const url = `${window.location.origin}/f/${form.slug}?resume=${creds.current.id}.${creds.current.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setManualLink(url);
    }
  }

  function closeManualLink() {
    setManualLink(null);
    finishLaterRef.current?.focus();
  }

  useEffect(() => {
    if (!manualLink) return;
    manualLinkRef.current?.focus();
    manualLinkRef.current?.select();
  }, [manualLink]);

  function submitClassic() {
    const errors: Record<string, string> = {};
    for (const ref of path.refs) {
      const message = validateAnswer(fieldByRef(form, ref)!, answersRef.current[ref]);
      if (message) errors[ref] = message;
    }
    setClassicErrors(errors);
    const first = Object.keys(errors)[0];
    if (first) {
      document.getElementById(`block-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    finish(path.end.kind === "ending" ? path.end.id : form.endings[0].id);
  }

  // Arrow keys move between questions in conversational mode.
  useEffect(() => {
    if (classic || contained) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "radio")) return;
      if (e.key === "Enter" && screen.kind === "welcome") {
        e.preventDefault();
        goNext();
      }
      if (e.key === "ArrowUp" && e.altKey) goBack();
      if (e.key === "ArrowDown" && e.altKey) goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Redirect after the ending, when the author set one.
  useEffect(() => {
    if (screen.kind !== "ending" || preview) return;
    const ending = form.endings.find((e) => e.id === screen.id);
    if (!ending?.redirectUrl) return;
    const t = setTimeout(() => {
      try {
        (window.top ?? window).location.href = ending.redirectUrl!;
      } catch {
        window.location.href = ending.redirectUrl!;
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [screen, preview, form.endings]);

  // ---- rendering ----------------------------------------------------------

  const t = form.theme;
  const rootStyle = {
    "--cf-bg": t.bg,
    "--cf-text": t.text,
    "--cf-accent": t.accent,
    "--cf-btn-text": t.buttonText,
    "--cf-radius": `${t.radius}px`,
    background: t.backgroundImage
      ? `linear-gradient(color-mix(in srgb, ${t.bg} 82%, transparent), color-mix(in srgb, ${t.bg} 82%, transparent)), url("${encodeURI(t.backgroundImage)}") center/cover`
      : t.bg,
    color: t.text,
    fontFamily: FONT_STACKS[t.font],
  } as React.CSSProperties;

  const questions = path.refs.filter((r) => isQuestion(fieldByRef(form, r)!));
  const answeredCount = questions.filter((r) => !isEmpty(answers[r])).length;
  const progress = screen.kind === "ending" ? 1 : questions.length ? answeredCount / questions.length : 0;
  const numberOf = (ref: string) => form.fields.filter(isQuestion).findIndex((f) => f.ref === ref) + 1;
  const center = t.align === "center";

  const button = (children: React.ReactNode, onClick: () => void, disabled?: boolean) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 px-5 py-2.5 text-lg font-semibold shadow-sm transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
      style={{ background: "var(--cf-accent)", color: "var(--cf-btn-text)", borderRadius: "var(--cf-radius)" }}
    >
      {children}
    </button>
  );

  function renderQuestion(field: Field, conversational: boolean) {
    const err = conversational ? (error?.ref === field.ref ? error : null) : classicErrors[field.ref] ? { message: classicErrors[field.ref], n: 0 } : null;
    const last = conversational && nextStep(form, field.ref, ctx).kind === "ending";
    const n = numberOf(field.ref);
    return (
      <div id={`block-${field.ref}`} className={`w-full ${field.type === "statement" && center ? "text-center" : ""}`}>
        <h2 id={`q-${field.id}`} className="flex gap-3 text-2xl font-medium leading-snug sm:text-3xl">
          {form.settings.showQuestionNumbers && isQuestion(field) && (
            <span className="shrink-0 pt-1 text-base font-semibold sm:text-lg" style={{ color: "var(--cf-accent)" }}>
              {n}→
            </span>
          )}
          <span>
            {recall(field.title, ctx) || <span className="opacity-40">Your question here…</span>}
            {field.required && isQuestion(field) && <span style={{ color: "var(--cf-accent)" }}> *</span>}
          </span>
        </h2>
        {field.description && (
          <p className="mt-2 whitespace-pre-line text-lg opacity-70">{recall(field.description, ctx)}</p>
        )}
        {field.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={field.imageUrl} alt="" className="mt-4 max-h-64 rounded-lg object-cover" style={{ borderRadius: "var(--cf-radius)" }} />
        )}
        <div className="mt-6">
          <FieldInput
            field={field}
            value={answers[field.ref]}
            onChange={(v) => updateAnswer(field.ref, v)}
            onSubmit={(v) => (conversational ? goNext(v) : undefined)}
            active={conversational}
            owner={conversational && !contained}
            autoAdvance={conversational}
            slug={form.slug}
            preview={preview}
            maxUploadMb={maxUploadMb}
            seed={creds.current?.id ?? form.id}
          />
        </div>
        {err && (
          <div
            key={err.n}
            role="alert"
            className="cf-shake mt-4 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium"
            style={{ background: "color-mix(in srgb, #e5484d 15%, transparent)", color: "inherit", borderRadius: "calc(var(--cf-radius) * 0.6)" }}
          >
            <span aria-hidden="true">⚠</span> {err.message}
          </div>
        )}
        {conversational && (
          <div className="mt-6 flex items-center gap-3">
            {button(
              <>
                {busy ? "Sending…" : field.type === "statement" ? field.buttonLabel || "Continue" : last ? "Submit" : "OK"}
                {!busy && !last && <span aria-hidden="true">✓</span>}
              </>,
              () => goNext(),
              busy,
            )}
            {!["long_text"].includes(field.type) && (
              <span className="hidden text-xs opacity-60 sm:inline">
                press <b>Enter ↵</b>
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  let body: React.ReactNode;
  if (screen.kind === "closed") {
    body = (
      <div className="cf-fade text-center">
        <p className="text-2xl font-medium sm:text-3xl">{screen.message}</p>
      </div>
    );
  } else if (screen.kind === "resume") {
    body = (
      <div className={`cf-in-up ${center ? "text-center" : ""}`}>
        <h1 className="text-3xl font-semibold sm:text-4xl">Welcome back.</h1>
        <p className="mt-3 text-lg opacity-70">You started this form earlier. Pick up where you left off?</p>
        <div className={`mt-8 flex flex-wrap gap-3 ${center ? "justify-center" : ""}`}>
          {button("Continue", continueResume)}
          <button type="button" onClick={startOver} className="px-4 py-2 text-lg underline-offset-4 opacity-80 hover:underline">
            Start over
          </button>
        </div>
      </div>
    );
  } else if (screen.kind === "welcome" && !classic) {
    body = (
      <div className={`cf-fade w-full ${center ? "text-center" : ""}`}>
        {form.welcome.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={form.welcome.imageUrl} alt="" className={`mb-6 max-h-56 object-cover ${center ? "mx-auto" : ""}`} style={{ borderRadius: "var(--cf-radius)" }} />
        )}
        <h1 className="text-3xl font-semibold leading-tight sm:text-5xl">{recall(form.welcome.title, ctx)}</h1>
        {form.welcome.description && <p className="mt-4 whitespace-pre-line text-lg opacity-70 sm:text-xl">{recall(form.welcome.description, ctx)}</p>}
        <div className={`mt-8 flex items-center gap-3 ${center ? "justify-center" : ""}`}>
          {button(form.welcome.buttonLabel || "Start", () => goNext())}
          <span className="hidden text-xs opacity-60 sm:inline">
            press <b>Enter ↵</b>
          </span>
        </div>
        {questions.length > 2 && (
          <p className="mt-4 text-sm opacity-60">
            ◷ Takes about {Math.max(1, Math.round(questions.length * 0.25))} min
          </p>
        )}
      </div>
    );
  } else if (screen.kind === "ending") {
    const ending = form.endings.find((e) => e.id === screen.id) ?? pickEnding(form, score);
    body = (
      <div className={`cf-in-up w-full ${center ? "text-center" : ""}`}>
        <div className={`mb-6 flex h-14 w-14 items-center justify-center text-2xl ${center ? "mx-auto" : ""}`} style={{ background: "var(--cf-accent)", color: "var(--cf-btn-text)", borderRadius: "50%" }} aria-hidden="true">
          ✓
        </div>
        <h1 className="text-3xl font-semibold leading-tight sm:text-5xl">{ending ? recall(ending.title, ctx) : "Thanks!"}</h1>
        {ending?.description && <p className="mt-4 whitespace-pre-line text-lg opacity-70 sm:text-xl">{recall(ending.description, ctx)}</p>}
        {offline && (
          <p className="mt-4 text-sm opacity-80">
            You&apos;re offline. Your answers are saved on this device and will send automatically when you&apos;re back online.
          </p>
        )}
        {ending?.buttonUrl && (
          <div className="mt-8">
            <a
              href={ending.buttonUrl}
              target="_top"
              rel="noopener"
              className="inline-flex px-5 py-2.5 text-lg font-semibold"
              style={{ background: "var(--cf-accent)", color: "var(--cf-btn-text)", borderRadius: "var(--cf-radius)" }}
            >
              {ending.buttonLabel || "Continue"}
            </a>
          </div>
        )}
        {ending?.redirectUrl && !preview && <p className="mt-6 text-sm opacity-60">Taking you onward…</p>}
        {preview && (
          <button type="button" onClick={startOver} className="mt-8 text-sm underline opacity-70">
            Restart preview
          </button>
        )}
      </div>
    );
  } else if (classic) {
    body = (
      <form
        className="w-full py-10"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submitClassic();
        }}
      >
        {form.welcome.enabled && (
          <header className={`mb-12 ${center ? "text-center" : ""}`}>
            <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{recall(form.welcome.title, ctx)}</h1>
            {form.welcome.description && <p className="mt-3 whitespace-pre-line text-lg opacity-70">{recall(form.welcome.description, ctx)}</p>}
          </header>
        )}
        <div className="flex flex-col gap-14">
          {path.refs.map((ref) => {
            const field = fieldByRef(form, ref)!;
            return (
              <section key={ref} className="cf-fade">
                {renderQuestion(field, false)}
              </section>
            );
          })}
        </div>
        {error?.ref === "_" && <p role="alert" className="mt-8 text-sm">{error.message}</p>}
        <div className="mt-12">
          <button
            type="submit"
            disabled={busy}
            className="px-6 py-3 text-lg font-semibold transition hover:brightness-110 disabled:opacity-60"
            style={{ background: "var(--cf-accent)", color: "var(--cf-btn-text)", borderRadius: "var(--cf-radius)" }}
          >
            {busy ? "Sending…" : "Submit"}
          </button>
        </div>
      </form>
    );
  } else if (screen.kind === "field") {
    const field = fieldByRef(form, screen.ref);
    body = field ? (
      <div key={field.ref} className={dir === "up" ? "cf-in-up w-full" : "cf-in-down w-full"}>
        {renderQuestion(field, true)}
        {error?.ref === "_" && <p role="alert" className="mt-4 text-sm">{error.message}</p>}
      </div>
    ) : null;
  }

  const showNav = !classic && screen.kind === "field";
  return (
    <div
      className={`relative flex flex-col ${contained ? "h-full overflow-auto" : "min-h-[100dvh]"}`}
      style={rootStyle}
      data-clayform={form.slug}
    >
      {form.settings.showProgress && screen.kind !== "welcome" && screen.kind !== "closed" && (
        <div
          className={`${contained ? "sticky" : "fixed"} left-0 right-0 top-0 z-10 h-1`}
          style={{ background: "color-mix(in srgb, var(--cf-accent) 18%, transparent)" }}
          role="progressbar"
          aria-label="Progress"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full transition-all duration-500" style={{ width: `${progress * 100}%`, background: "var(--cf-accent)" }} />
        </div>
      )}
      <main className={`mx-auto flex w-full max-w-2xl flex-1 px-6 ${classic && screen.kind === "welcome" ? "items-start" : "items-center"} py-16 sm:px-8`}>
        {body}
      </main>
      {(showNav || form.settings.branding || !!reportUrl || (form.settings.allowResume && !preview && screen.kind === "field" && answeredCount > 0) || offline) && (
        <footer
          className={`${contained ? "sticky" : "fixed"} bottom-0 left-0 right-0 flex items-center justify-between gap-3 p-3 sm:p-4`}
          style={{ background: classic ? "var(--cf-bg)" : undefined }}
        >
          {manualLink && (
            <div
              role="group"
              aria-labelledby="cf-resume-link-label"
              className="absolute bottom-full left-3 right-3 mb-2 p-3 shadow-lg sm:left-4 sm:right-auto sm:w-[26rem]"
              style={{
                background: "var(--cf-bg)",
                color: "var(--cf-text)",
                border: "1px solid color-mix(in srgb, var(--cf-text) 18%, transparent)",
                borderRadius: "var(--cf-radius)",
              }}
              onKeyDown={(e) => e.key === "Escape" && closeManualLink()}
            >
              <label id="cf-resume-link-label" htmlFor="cf-resume-link" className="block text-sm font-semibold">
                Copy this link to finish later
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="cf-resume-link"
                  ref={manualLinkRef}
                  readOnly
                  value={manualLink}
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 bg-transparent px-2 py-1.5 font-mono text-xs outline-none"
                  style={{ border: "1px solid color-mix(in srgb, var(--cf-text) 25%, transparent)", borderRadius: "calc(var(--cf-radius) * 0.6)" }}
                />
                <button
                  type="button"
                  onClick={closeManualLink}
                  className="shrink-0 px-3 py-1.5 text-sm font-semibold transition hover:brightness-110"
                  style={{ background: "var(--cf-accent)", color: "var(--cf-btn-text)", borderRadius: "calc(var(--cf-radius) * 0.6)" }}
                >
                  Done
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 text-xs">
            {form.settings.branding && (
              <a
                href="https://github.com/claycovyn/clayform"
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-semibold opacity-80 hover:opacity-100"
                style={{ background: "color-mix(in srgb, var(--cf-text) 8%, transparent)", borderRadius: 999 }}
              >
                Made with Clayform
              </a>
            )}
            {offline && <span className="opacity-70">Offline — saving on this device</span>}
            {reportUrl && (
              <a href={reportUrl} target="_blank" rel="noopener" className="px-1 py-2 opacity-50 underline-offset-2 hover:underline hover:opacity-100">
                Report
              </a>
            )}
            {form.settings.allowResume && !preview && answeredCount > 0 && screen.kind === "field" && (
              <button ref={finishLaterRef} type="button" onClick={copyResumeLink} className="px-1 py-2 underline-offset-2 opacity-70 hover:underline hover:opacity-100">
                {copied ? "Link copied ✓" : "Finish later"}
              </button>
            )}
          </div>
          {showNav && (
            <div className="flex overflow-hidden" style={{ borderRadius: "calc(var(--cf-radius) * 0.6)" }}>
              <button
                type="button"
                aria-label="Previous question"
                onClick={goBack}
                className="px-3 py-1.5 text-lg transition hover:brightness-110"
                style={{ background: "var(--cf-accent)", color: "var(--cf-btn-text)" }}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Next question"
                onClick={() => goNext()}
                className="border-l px-3 py-1.5 text-lg transition hover:brightness-110"
                style={{ background: "var(--cf-accent)", color: "var(--cf-btn-text)", borderColor: "color-mix(in srgb, var(--cf-btn-text) 30%, transparent)" }}
              >
                ↓
              </button>
            </div>
          )}
        </footer>
      )}
    </div>
  );
}
