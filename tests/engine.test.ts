import { describe, expect, it } from "vitest";
import {
  computeScore,
  evaluateCondition,
  lintForm,
  nextStep,
  npsScore,
  recall,
  resolvePath,
  seededShuffle,
  validateAnswer,
} from "@/lib/engine";
import { newField } from "@/lib/fields";
import { parseForm } from "@/lib/schema";
import { TEMPLATES } from "@/lib/templates";
import type { Ctx, Form } from "@/lib/types";

const build = (id: string): Form => TEMPLATES.find((t) => t.id === id)!.build();
const ctx = (answers: Ctx["answers"], hidden: Ctx["hidden"] = {}, score = 0): Ctx => ({ answers, hidden, score });

describe("templates", () => {
  it("every template is a valid, lint-clean form", () => {
    for (const t of TEMPLATES) {
      const form = t.build();
      const parsed = parseForm(JSON.parse(JSON.stringify(form)));
      expect(parsed.ok, `${t.id}: ${!parsed.ok && parsed.error}`).toBe(true);
      if (t.id !== "blank") expect(lintForm(form), t.id).toEqual([]);
    }
  });
});

describe("logic", () => {
  it("jumps when a rule matches, otherwise goes to the next question", () => {
    const form = build("contact");
    expect(nextStep(form, "need", ctx({ need: "A new project" }))).toEqual({ kind: "field", ref: "budget" });
    expect(nextStep(form, "need", ctx({ need: "Support" }))).toEqual({ kind: "field", ref: "details" });
  });

  it("can jump straight to a specific ending", () => {
    const form = build("rsvp");
    const sorry = form.endings[1];
    expect(nextStep(form, "coming", ctx({ coming: false }))).toEqual({ kind: "ending", id: sorry.id });
    expect(nextStep(form, "coming", ctx({ coming: true }))).toEqual({ kind: "field", ref: "guests" });
  });

  it("resolves the full path a respondent will see", () => {
    const form = build("nps");
    expect(resolvePath(form, ctx({ nps: 3 })).refs).toEqual(["nps", "fix", "support"]);
    expect(resolvePath(form, ctx({ nps: 10 })).refs).toEqual(["nps", "love", "support"]);
  });

  it("stops instead of looping on a backwards jump", () => {
    const form = build("contact");
    form.logic.push({ id: "loop", fromRef: "details", match: "all", conditions: [{ source: { kind: "field", ref: "name" }, op: "answered" }], goTo: "name" });
    const path = resolvePath(form, ctx({ name: "Ada", need: "Support" }));
    expect(path.end.kind).toBe("ending");
    expect(lintForm(form).some((p) => p.includes("backwards"))).toBe(true);
  });

  it("evaluates operators", () => {
    const c = (op: Parameters<typeof evaluateCondition>[0]["op"], value: string | undefined, answer: unknown) =>
      evaluateCondition({ source: { kind: "field", ref: "x" }, op, value }, ctx({ x: answer as never }));
    expect(c("is", "yes", true)).toBe(true);
    expect(c("is", "no", false)).toBe(true);
    expect(c("is", "10", 10)).toBe(true);
    expect(c("is", "vegan", ["Vegan", "Gluten-free"])).toBe(true);
    expect(c("is_not", "vegan", ["Vegan"])).toBe(false);
    expect(c("is_not", "x", undefined)).toBe(false);
    expect(c("contains", "gmail", "ada@gmail.com")).toBe(true);
    expect(c("not_contains", "gmail", "ada@proton.me")).toBe(true);
    expect(c("starts_with", "ad", "Ada")).toBe(true);
    expect(c("gt", "5", 6)).toBe(true);
    expect(c("gte", "5", 5)).toBe(true);
    expect(c("lt", "5", "abc")).toBe(false);
    expect(c("answered", undefined, "  ")).toBe(false);
    expect(c("not_answered", undefined, [])).toBe(true);
    expect(evaluateCondition({ source: { kind: "hidden", key: "plan" }, op: "is", value: "pro" }, ctx({}, { plan: "Pro" }))).toBe(true);
    expect(evaluateCondition({ source: { kind: "score" }, op: "gte", value: "2" }, ctx({}, {}, 3))).toBe(true);
  });
});

describe("scoring", () => {
  it("adds points for picked choices and picks the ending by score range", () => {
    const form = build("quiz");
    const perfect = { q1: "Brazil", q2: "False", q3: "A shorter, stronger espresso" };
    expect(computeScore(form, perfect)).toBe(3);
    expect(resolvePath(form, ctx(perfect, {}, 3)).end).toEqual({ kind: "ending", id: form.endings[0].id });
    expect(resolvePath(form, ctx({ q1: "Brazil" }, {}, 1)).end).toEqual({ kind: "ending", id: form.endings[1].id });
    expect(resolvePath(form, ctx({}, {}, 0)).end).toEqual({ kind: "ending", id: form.endings[2].id });
  });
});

describe("validation", () => {
  it("enforces required and formats", () => {
    expect(validateAnswer({ ...newField("short_text"), required: true }, "")).toMatch(/required/);
    expect(validateAnswer(newField("short_text"), "")).toBeNull();
    expect(validateAnswer(newField("email"), "ada@example")).not.toBeNull();
    expect(validateAnswer(newField("email"), "ada@example.com")).toBeNull();
    expect(validateAnswer(newField("phone"), "+44 20 7946 0958")).toBeNull();
    expect(validateAnswer(newField("phone"), "call me")).not.toBeNull();
    expect(validateAnswer(newField("url"), "clayform.dev")).toBeNull();
    expect(validateAnswer({ ...newField("number"), min: 0, max: 5 }, 6)).not.toBeNull();
    expect(validateAnswer(newField("date"), "2026-10-12")).toBeNull();
    expect(validateAnswer(newField("date"), "12/10/2026")).not.toBeNull();
    expect(validateAnswer(newField("nps"), 11)).not.toBeNull();
    expect(validateAnswer(newField("nps"), 0)).toBeNull();
    expect(validateAnswer({ ...newField("rating"), steps: 5 }, 0)).not.toBeNull();
    expect(validateAnswer({ ...newField("legal"), required: true }, false)).not.toBeNull();
  });

  it("only accepts listed choices, plus one Other when allowed", () => {
    const f = newField("multiple_choice");
    expect(validateAnswer(f, "Option A")).toBeNull();
    expect(validateAnswer(f, "Hacked")).not.toBeNull();
    expect(validateAnswer({ ...f, allowOther: true }, "Something else")).toBeNull();
    expect(validateAnswer(f, ["Option A", "Option B"])).toMatch(/just one/);
    expect(validateAnswer({ ...f, multiple: true, max: 1 }, ["Option A", "Option B"])).toMatch(/up to 1/);
  });

  it("requires every item in a ranking", () => {
    const f = newField("ranking");
    expect(validateAnswer(f, ["Option C", "Option A", "Option B"])).toBeNull();
    expect(validateAnswer(f, ["Option C", "Option A"])).not.toBeNull();
  });
});

describe("recall and helpers", () => {
  it("fills in answers, hidden fields and score", () => {
    expect(recall("Hi {{name}}, from {{ source }}. Score {{score}}. {{missing}}!", ctx({ name: "Ada" }, { source: "ads" }, 4))).toBe(
      "Hi Ada, from ads. Score 4.!",
    );
    expect(recall("Nice to meet you, {{name}}. What's your email?", ctx({}))).toBe("Nice to meet you. What's your email?");
    expect(recall("Thanks {{name}}!", ctx({}))).toBe("Thanks!");
    expect(recall("Hi {{name}}, welcome", ctx({}))).toBe("Hi, welcome");
    expect(recall("{{diet}}", ctx({ diet: ["Vegan", "None"] }))).toBe("Vegan, None");
  });

  it("calculates NPS", () => {
    expect(npsScore([10, 9, 8, 7, 3])).toBe(20);
    expect(npsScore([])).toBeNull();
  });

  it("shuffles deterministically", () => {
    const items = [1, 2, 3, 4, 5, 6];
    expect(seededShuffle(items, "a")).toEqual(seededShuffle(items, "a"));
    expect([...seededShuffle(items, "a")].sort()).toEqual(items);
  });
});

describe("schema", () => {
  it("rejects unsafe or malformed input", () => {
    const form = build("contact");
    expect(parseForm({ ...form, slug: "Has Spaces" }).ok).toBe(false);
    expect(parseForm({ ...form, theme: { ...form.theme, bg: "red; background:url(x)" } }).ok).toBe(false);
    expect(parseForm({ ...form, endings: [{ ...form.endings[0], buttonUrl: "javascript:alert(1)" }] }).ok).toBe(false);
  });
});
