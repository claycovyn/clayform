/**
 * In-app replacement for window.confirm / window.prompt. Pure and framework-free so it can be unit
 * tested; `src/components/ui/Dialog.tsx` renders whatever request is at the head of the queue.
 */

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" uses a red button, role="alertdialog", and focuses Cancel first. */
  tone?: "default" | "danger";
}

export interface PromptOptions {
  title: string;
  body?: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Return an error message to keep the dialog open, or nothing to accept the value. */
  validate?: (value: string) => string | null | undefined | void;
  /** Show the value for the person to copy (no Cancel button; resolves with the value). */
  readOnly?: boolean;
  multiline?: boolean;
}

export type DialogRequest =
  | { id: number; kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { id: number; kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void };

export interface DialogStore {
  confirm(options: ConfirmOptions): Promise<boolean>;
  prompt(options: PromptOptions): Promise<string | null>;
  /** The dialog on screen, or null. */
  current(): DialogRequest | null;
  subscribe(listener: () => void): () => void;
  /** Confirm dialogs: OK (true) or Cancel (false). */
  answer(ok: boolean): void;
  /** Prompt dialogs: returns the validation error and stays open, or resolves and returns null. */
  submit(value: string): string | null;
  /** Esc, backdrop or Cancel: confirm resolves false, prompt resolves null. */
  cancel(): void;
}

export function createDialogStore(): DialogStore {
  const queue: DialogRequest[] = [];
  const listeners = new Set<() => void>();
  let nextId = 1;

  const emit = () => listeners.forEach((l) => l());
  const push = (r: DialogRequest) => {
    queue.push(r);
    emit();
  };
  const shift = () => {
    queue.shift();
    emit();
  };

  return {
    confirm: (options) => new Promise<boolean>((resolve) => push({ id: nextId++, kind: "confirm", options, resolve })),
    prompt: (options) => new Promise<string | null>((resolve) => push({ id: nextId++, kind: "prompt", options, resolve })),
    current: () => queue[0] ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    answer(ok) {
      const r = queue[0];
      if (!r) return;
      if (r.kind === "confirm") r.resolve(ok);
      else r.resolve(ok ? (r.options.defaultValue ?? "") : null);
      shift();
    },
    submit(value) {
      const r = queue[0];
      if (!r) return null;
      if (r.kind === "confirm") {
        r.resolve(true);
        shift();
        return null;
      }
      const error = r.options.readOnly ? null : r.options.validate?.(value);
      if (error) return error;
      r.resolve(value);
      shift();
      return null;
    },
    cancel() {
      const r = queue[0];
      if (!r) return;
      if (r.kind === "confirm") r.resolve(false);
      else r.resolve(r.options.readOnly ? (r.options.defaultValue ?? "") : null);
      shift();
    },
  };
}
