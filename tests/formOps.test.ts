import { describe, expect, it } from "vitest";
import {
  addField,
  createForm,
  FormOpError,
  publish,
  removeField,
  reorderFields,
  setEndings,
  setLogic,
  setTheme,
  setWebhook,
  unpublish,
  updateField,
  updateForm,
  updateSettings,
} from "@/lib/formOps";
import { lintForm } from "@/lib/engine";

const contact = () =>
  createForm("Contact", [
    { type: "short_text", title: "What's your name?", ref: "name", required: true },
    { type: "multiple_choice", title: "What do you need?", ref: "need", choices: ["A new project", "Support"] },
    { type: "long_text", title: "Tell us more", ref: "details" },
    { type: "email", title: "Your email?", ref: "email", required: true },
  ]);

describe("form ops", () => {
  it("creates a valid draft with generated ids and the given keys", () => {
    const f = contact();
    expect(f.status).toBe("draft");
    expect(f.fields.map((x) => x.ref)).toEqual(["name", "need", "details", "email"]);
    expect(f.fields[1].choices!.map((c) => c.label)).toEqual(["A new project", "Support"]);
    expect(new Set(f.fields.map((x) => x.id)).size).toBe(4);
    expect(lintForm(f)).toEqual([]);
  });

  it("adds questions with sensible defaults and generated keys", () => {
    const { form, field } = addField(contact(), { type: "nps", title: "Would you recommend us?" });
    expect(field.ref).toBe("nps_1");
    expect(field.labels).toBeTruthy();
    expect(form.fields.at(-1)!.ref).toBe("nps_1");
    const { form: f2 } = addField(form, { type: "rating", title: "Rate us", position: 0, properties: { steps: 10 } });
    expect(f2.fields[0]).toMatchObject({ type: "rating", steps: 10 });
  });

  it("rejects bad input with messages an agent can act on", () => {
    expect(() => addField(contact(), { type: "short_text", title: "x", ref: "name" })).toThrow(/already uses the key "name"/);
    expect(() => addField(contact(), { type: "short_text", title: "x", ref: "bad key!" })).toThrow(FormOpError);
    expect(() => addField(contact(), { type: "email", title: "x", choices: ["a"] })).toThrow(/don't take options/);
    expect(() => addField(contact(), { type: "nope" as never, title: "x" })).toThrow(/list_field_types/);
    expect(() => addField(contact(), { type: "short_text", title: "x", properties: { color: "red" } as never })).toThrow(/Unknown properties/);
    expect(() => addField(contact(), { type: "rating", title: "x", properties: { steps: 40 } })).toThrow(/steps/);
    expect(() => updateField(contact(), "missing", { title: "x" })).toThrow(/Keys in this form: name, need, details, email/);
  });

  it("renaming a key updates the logic that uses it", () => {
    let f = setLogic(contact(), [{ from: "need", conditions: [{ source: "need", op: "is", value: "Support" }], goTo: "email" }]);
    f = updateField(f, "need", { ref: "topic" }).form;
    expect(f.logic[0]).toMatchObject({ fromRef: "topic", goTo: "email", conditions: [{ source: { kind: "field", ref: "topic" } }] });
    f = updateField(f, "email", { ref: "mail" }).form;
    expect(f.logic[0].goTo).toBe("mail");
  });

  it("removing a question removes rules that use it", () => {
    const f = setLogic(contact(), [{ from: "need", conditions: [{ source: "need", op: "is", value: "Support" }], goTo: "email" }]);
    const { form, removedRules } = removeField(f, "email");
    expect(removedRules).toBe(1);
    expect(form.logic).toEqual([]);
  });

  it("logic must point at real questions and endings, and only jump forward", () => {
    const f = contact();
    expect(() => setLogic(f, [{ from: "need", conditions: [{ source: "need", op: "is", value: "x" }], goTo: "nowhere" }])).toThrow(/No question/);
    expect(() => setLogic(f, [{ from: "email", conditions: [{ source: "email", op: "answered" }], goTo: "name" }])).toThrow(/jump back/);
    expect(() => setLogic(f, [{ from: "need", conditions: [{ source: "need", op: "is" }], goTo: "email" }])).toThrow(/needs a value/);
    expect(() => setLogic(f, [{ from: "need", conditions: [{ source: "hidden:utm", op: "is", value: "x" }], goTo: "email" }])).toThrow(/hidden fields/);
    expect(() => setLogic(f, [{ from: "need", conditions: [], goTo: "email" }])).toThrow(/at least one condition/);
    const ok = setLogic(f, [{ from: "need", match: "any", conditions: [{ source: "score", op: "gte", value: 5 }], goTo: `ending:${f.endings[0].id}` }]);
    expect(ok.logic[0]).toMatchObject({ match: "any", conditions: [{ source: { kind: "score" }, op: "gte", value: "5" }] });
    // Reordering can't create a backwards jump.
    const withJump = setLogic(f, [{ from: "name", conditions: [{ source: "name", op: "answered" }], goTo: "email" }]);
    expect(() => reorderFields(withJump, ["email", "name", "need", "details"])).toThrow(/jump back/);
    expect(() => reorderFields(f, ["name", "need"])).toThrow(/exactly once/);
    expect(reorderFields(f, ["need", "name", "details", "email"]).fields[0].ref).toBe("need");
  });

  it("endings keep ids so logic survives, and can't orphan a rule", () => {
    const f = contact();
    const id = f.endings[0].id;
    const withRule = setLogic(f, [{ from: "need", conditions: [{ source: "need", op: "is", value: "Support" }], goTo: `ending:${id}` }]);
    expect(() => setEndings(withRule, [{ title: "Bye" }])).toThrow(/Keep that ending's id/);
    const next = setEndings(withRule, [{ id, title: "Thanks!" }, { title: "High score", minScore: 10 }]);
    expect(next.endings).toHaveLength(2);
    expect(next.endings[1].id).toMatch(/^[a-z0-9]+$/);
    expect(() => setEndings(f, [])).toThrow(/at least one ending/);
  });

  it("theme, settings, webhook and form patches", () => {
    let f = setTheme(contact(), { preset: "midnight" });
    expect(f.theme.preset).toBe("Midnight");
    f = setTheme(f, { accent: "#ff0000" });
    expect(f.theme).toMatchObject({ preset: "Custom", accent: "#ff0000" });
    expect(() => setTheme(f, { preset: "Neon" })).toThrow(/Presets:/);
    expect(() => setTheme(f, { accent: "red" })).toThrow();
    f = updateSettings(f, { mode: "classic", responseLimit: 100 });
    expect(f.settings).toMatchObject({ mode: "classic", responseLimit: 100 });
    expect(() => updateSettings(f, { webhookUrl: "https://x" } as never)).toThrow(/set_webhook/);
    expect(() => updateSettings(f, { closeAt: "tomorrow" })).toThrow(/ISO/);
    f = setWebhook(f, "https://example.com/hook", "s3cret");
    expect(f.settings).toMatchObject({ webhookUrl: "https://example.com/hook", webhookSecret: "s3cret" });
    f = setWebhook(f, null);
    expect(f.settings.webhookUrl).toBeUndefined();
    expect(f.settings.webhookSecret).toBeUndefined();
    f = updateForm(f, { title: "Hello", slug: "my-form", hiddenFields: ["utm", "utm"] });
    expect(f).toMatchObject({ title: "Hello", slug: "my-form", hiddenFields: ["utm"] });
    expect(() => updateForm(f, { slug: "No Spaces" })).toThrow(/Links use/);
  });

  it("publishing refuses a form with problems and lists them", () => {
    expect(() => publish(createForm("Empty"))).toThrow(/Add at least one question/);
    const { form } = addField(contact(), { type: "short_text", title: "" });
    expect(() => publish(form)).toThrow(/has no text/);
    const live = publish(contact());
    expect(live.status).toBe("published");
    expect(unpublish(live).status).toBe("draft");
  });
});
