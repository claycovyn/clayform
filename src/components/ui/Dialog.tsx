"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createDialogStore, type DialogRequest, type DialogStore } from "@/lib/dialogs";

export type { ConfirmOptions, PromptOptions } from "@/lib/dialogs";

const DialogContext = createContext<DialogStore | null>(null);

function useStore(): DialogStore {
  const store = useContext(DialogContext);
  if (!store) throw new Error("Wrap the app in <DialogProvider>.");
  return store;
}

/** `const confirmDialog = useConfirm(); if (!(await confirmDialog({ title, body, confirmLabel: "Delete", tone: "danger" }))) return;` */
export function useConfirm() {
  return useStore().confirm;
}

/** `const value = await promptDialog({ title, label, defaultValue, validate })` — null when cancelled. */
export function usePrompt() {
  return useStore().prompt;
}

/** Admin-side dialogs. The respondent-facing Player never uses these. */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(createDialogStore);
  const current = useSyncExternalStore(store.subscribe, store.current, () => null);
  return (
    <DialogContext.Provider value={store}>
      {children}
      {current && <DialogView key={current.id} request={current} store={store} />}
    </DialogContext.Provider>
  );
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function DialogView({ request, store }: { request: DialogRequest; store: DialogStore }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();
  const bodyId = useId();
  const fieldId = useId();
  const errorId = useId();

  const o = request.options;
  const danger = request.kind === "confirm" && request.options.tone === "danger";
  const prompt = request.kind === "prompt" ? request.options : null;
  const [value, setValue] = useState(prompt?.defaultValue ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current!;
    const returnTo = document.activeElement as HTMLElement | null;
    dialog.showModal();
    if (prompt) {
      fieldRef.current?.focus();
      fieldRef.current?.select();
    } else if (danger) cancelRef.current?.focus();
    else okRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      returnTo?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key !== "Tab") return;
    const items = Array.from(ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (request.kind === "confirm") return store.answer(true);
    const message = store.submit(value);
    if (message) {
      setError(message);
      fieldRef.current?.focus();
    }
  }

  const fieldClass = `field ${error ? "border-red-500 focus:border-red-500 focus:ring-red-500/20" : ""} ${prompt?.readOnly ? "font-mono" : ""}`;
  const fieldProps = {
    id: fieldId,
    ref: fieldRef,
    value,
    placeholder: prompt?.placeholder,
    readOnly: prompt?.readOnly,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      setValue(e.target.value);
      if (error) setError(null);
    },
  };

  return (
    <dialog
      ref={ref}
      role={danger ? "alertdialog" : "dialog"}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={o.body ? bodyId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        store.cancel();
      }}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => (pressedOnBackdrop.current = e.target === ref.current)}
      onClick={(e) => {
        if (e.target === ref.current && pressedOnBackdrop.current) store.cancel();
      }}
      className="cf-dialog m-0 mt-auto w-full max-w-full rounded-t-2xl bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/50 sm:m-auto sm:max-w-md sm:rounded-2xl"
    >
      <form onSubmit={onSubmit} className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">
        <h2 id={titleId} className="font-display text-lg font-extrabold leading-snug">
          {o.title}
        </h2>
        {o.body && (
          <p id={bodyId} className="mt-2 text-sm leading-relaxed text-ink-soft">
            {o.body}
          </p>
        )}
        {prompt && (
          <div className="mt-4">
            <label htmlFor={fieldId} className="label">
              {prompt.label}
            </label>
            {prompt.multiline ? (
              <textarea {...fieldProps} rows={5} className={`${fieldClass} resize-none text-xs leading-relaxed`} />
            ) : (
              <input {...fieldProps} className={fieldClass} />
            )}
            {error && (
              <p id={errorId} role="alert" className="mt-1 text-xs text-red-600">
                {error}
              </p>
            )}
          </div>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {!prompt?.readOnly && (
            <button ref={cancelRef} type="button" className="btn-outline py-2.5 sm:py-2" onClick={() => store.cancel()}>
              {o.cancelLabel ?? "Cancel"}
            </button>
          )}
          <button ref={okRef} type="submit" className={`${danger ? "btn-danger" : "btn-brand"} py-2.5 sm:py-2`}>
            {o.confirmLabel ?? (prompt?.readOnly ? "Done" : "OK")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
