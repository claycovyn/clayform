import { describe, expect, it, vi } from "vitest";
import { createDialogStore } from "@/lib/dialogs";

describe("in-app dialogs", () => {
  it("confirm resolves true when confirmed and false when cancelled", async () => {
    const store = createDialogStore();
    const yes = store.confirm({ title: "Delete form", tone: "danger" });
    expect(store.current()?.kind).toBe("confirm");
    store.answer(true);
    await expect(yes).resolves.toBe(true);
    expect(store.current()).toBeNull();

    const no = store.confirm({ title: "Delete form" });
    store.cancel(); // Esc, backdrop or Cancel
    await expect(no).resolves.toBe(false);

    const enter = store.confirm({ title: "Revoke key" });
    expect(store.submit("")).toBeNull(); // form submit = confirm
    await expect(enter).resolves.toBe(true);
  });

  it("prompt resolves the typed value, or null when cancelled", async () => {
    const store = createDialogStore();
    const named = store.prompt({ title: "Rename", label: "Name", defaultValue: "Old" });
    expect(store.submit("New name")).toBeNull();
    await expect(named).resolves.toBe("New name");

    const cancelled = store.prompt({ title: "Rename", label: "Name" });
    store.cancel();
    await expect(cancelled).resolves.toBeNull();
  });

  it("prompt validation keeps the dialog open until the value passes", async () => {
    const store = createDialogStore();
    const validate = vi.fn((v: string) => (v.trim().length < 3 ? "At least 3 characters." : null));
    const p = store.prompt({ title: "Custom link", label: "Slug", validate });
    const settled = vi.fn();
    void p.then(settled);

    expect(store.submit("ab")).toBe("At least 3 characters.");
    expect(store.current()?.kind).toBe("prompt");
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    expect(store.submit("abc")).toBeNull();
    await expect(p).resolves.toBe("abc");
    expect(validate).toHaveBeenCalledTimes(2);
    expect(store.current()).toBeNull();
  });

  it("read-only prompts (copy by hand) skip validation and resolve the value", async () => {
    const store = createDialogStore();
    const p = store.prompt({ title: "Copy it yourself", label: "Text to copy", defaultValue: "https://x/f/a", readOnly: true, validate: () => "never" });
    store.cancel();
    await expect(p).resolves.toBe("https://x/f/a");
  });

  it("queues dialogs and notifies subscribers", async () => {
    const store = createDialogStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    const a = store.confirm({ title: "A" });
    const b = store.confirm({ title: "B" });
    expect(store.current()?.options.title).toBe("A");
    store.answer(false);
    expect(store.current()?.options.title).toBe("B");
    store.answer(true);
    await expect(a).resolves.toBe(false);
    await expect(b).resolves.toBe(true);
    expect(listener).toHaveBeenCalledTimes(4);
    off();
    store.confirm({ title: "C" });
    expect(listener).toHaveBeenCalledTimes(4);
  });
});
