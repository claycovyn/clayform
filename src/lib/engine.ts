// The form engine: logic jumps, scoring, recall, validation.
// Pure functions shared by the player (browser) and the API (server), so the
// server re-checks everything the browser claims.

import type { AnswerValue, Answers, Condition, Ctx, Ending, Field, FileAnswer, Form } from "./types";

export type Step = { kind: "field"; ref: string } | { kind: "ending"; id: string };

const INPUT_FREE: Field["type"][] = ["statement"];

export function isQuestion(field: Field): boolean {
  return !INPUT_FREE.includes(field.type);
}

export function isEmpty(value: AnswerValue | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function fieldByRef(form: Form, ref: string): Field | undefined {
  return form.fields.find((f) => f.ref === ref);
}

/** Sum of the scores of every picked choice. */
export function computeScore(form: Form, answers: Answers): number {
  let score = 0;
  for (const field of form.fields) {
    if (!field.choices) continue;
    const value = answers[field.ref];
    const picked = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    for (const label of picked) {
      const choice = field.choices.find((c) => c.label === label);
      if (choice?.score) score += choice.score;
    }
  }
  return score;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toText(value: AnswerValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return value.name;
  return String(value);
}

function sourceValue(cond: Condition, ctx: Ctx): AnswerValue | undefined {
  switch (cond.source.kind) {
    case "score":
      return ctx.score;
    case "hidden":
      return ctx.hidden[cond.source.key];
    case "field":
      return ctx.answers[cond.source.ref];
  }
}

export function evaluateCondition(cond: Condition, ctx: Ctx): boolean {
  const actual = sourceValue(cond, ctx);
  const expected = (cond.value ?? "").trim();
  const lower = expected.toLowerCase();

  if (cond.op === "answered") return !isEmpty(actual);
  if (cond.op === "not_answered") return isEmpty(actual);

  if (cond.op === "gt" || cond.op === "lt" || cond.op === "gte" || cond.op === "lte") {
    const a = toNumber(actual);
    const b = toNumber(expected);
    if (a === null || b === null) return false;
    if (cond.op === "gt") return a > b;
    if (cond.op === "lt") return a < b;
    if (cond.op === "gte") return a >= b;
    return a <= b;
  }

  // Equality and text operators. Arrays (multi-select, ranking) match per item.
  const items = Array.isArray(actual) ? actual.map((v) => v.toLowerCase()) : [toText(actual).toLowerCase()];
  const numA = toNumber(actual);
  const numB = toNumber(expected);
  const equals = () =>
    numA !== null && numB !== null && !Array.isArray(actual) ? numA === numB : items.includes(lower);

  switch (cond.op) {
    case "is":
      return equals();
    case "is_not":
      return !isEmpty(actual) && !equals();
    case "contains":
      return items.some((v) => v.includes(lower));
    case "not_contains":
      return !items.some((v) => v.includes(lower));
    case "starts_with":
      return items.some((v) => v.startsWith(lower));
  }
  return false;
}

export function pickEnding(form: Form, score: number): Ending | undefined {
  const scored = form.endings.find(
    (e) =>
      (e.minScore !== undefined || e.maxScore !== undefined) &&
      (e.minScore === undefined || score >= e.minScore) &&
      (e.maxScore === undefined || score <= e.maxScore),
  );
  return scored ?? form.endings.find((e) => e.minScore === undefined && e.maxScore === undefined) ?? form.endings[0];
}

function endingStep(form: Form, ctx: Ctx): Step {
  return { kind: "ending", id: pickEnding(form, ctx.score)?.id ?? "default" };
}

/** Where the respondent goes after `ref`, given what they've answered so far. */
export function nextStep(form: Form, ref: string, ctx: Ctx): Step {
  for (const rule of form.logic) {
    if (rule.fromRef !== ref || rule.conditions.length === 0) continue;
    const hit =
      rule.match === "all"
        ? rule.conditions.every((c) => evaluateCondition(c, ctx))
        : rule.conditions.some((c) => evaluateCondition(c, ctx));
    if (!hit) continue;
    if (rule.goTo.startsWith("ending:")) return { kind: "ending", id: rule.goTo.slice(7) };
    if (fieldByRef(form, rule.goTo)) return { kind: "field", ref: rule.goTo };
  }
  const index = form.fields.findIndex((f) => f.ref === ref);
  const next = form.fields[index + 1];
  return next ? { kind: "field", ref: next.ref } : endingStep(form, ctx);
}

export function firstStep(form: Form, ctx: Ctx): Step {
  return form.fields[0] ? { kind: "field", ref: form.fields[0].ref } : endingStep(form, ctx);
}

/**
 * Walk the form from the start with the current answers and return every field
 * the respondent will see, plus where they end up. Loops are cut off: a jump to
 * a field already on the path ends the walk.
 */
export function resolvePath(form: Form, ctx: Ctx): { refs: string[]; end: Step } {
  const refs: string[] = [];
  const seen = new Set<string>();
  let step = firstStep(form, ctx);
  while (step.kind === "field" && !seen.has(step.ref)) {
    seen.add(step.ref);
    refs.push(step.ref);
    step = nextStep(form, step.ref, ctx);
  }
  if (step.kind === "field") step = endingStep(form, ctx);
  return { refs, end: step };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 ()\-.]{6,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns an error message, or null when the value is acceptable. */
export function validateAnswer(field: Field, value: AnswerValue | undefined): string | null {
  if (!isQuestion(field)) return null;
  if (isEmpty(value)) {
    if (field.type === "legal" && field.required) return "Please accept to continue.";
    return field.required ? "This one's required." : null;
  }
  const v = value as AnswerValue;
  switch (field.type) {
    case "short_text":
    case "long_text": {
      if (typeof v !== "string") return "Please type an answer.";
      const limit = field.maxLength ?? (field.type === "short_text" ? 500 : 10000);
      if (v.length > limit) return `Keep it under ${limit} characters.`;
      return null;
    }
    case "email":
      return typeof v === "string" && EMAIL.test(v.trim()) ? null : "That email doesn't look right.";
    case "phone":
      return typeof v === "string" && PHONE.test(v.trim()) && v.replace(/\D/g, "").length >= 6
        ? null
        : "That phone number doesn't look right.";
    case "url":
      try {
        const u = new URL(typeof v === "string" && !/^https?:\/\//i.test(v) ? `https://${v}` : String(v));
        return u.hostname.includes(".") ? null : "That link doesn't look right.";
      } catch {
        return "That link doesn't look right.";
      }
    case "number": {
      const n = toNumber(v);
      if (n === null) return "Please enter a number.";
      if (field.min !== undefined && n < field.min) return `The smallest allowed is ${field.min}.`;
      if (field.max !== undefined && n > field.max) return `The largest allowed is ${field.max}.`;
      return null;
    }
    case "date":
      return typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v)) ? null : "Please pick a date.";
    case "yes_no":
      return typeof v === "boolean" ? null : "Pick yes or no.";
    case "legal":
      if (v !== true && field.required) return "Please accept to continue.";
      return typeof v === "boolean" ? null : "Please accept to continue.";
    case "rating":
    case "opinion_scale":
    case "nps": {
      const n = toNumber(v);
      const { start, end } = scaleRange(field);
      return n !== null && Number.isInteger(n) && n >= start && n <= end ? null : "Pick a value on the scale.";
    }
    case "multiple_choice":
    case "picture_choice":
    case "dropdown": {
      const picked = Array.isArray(v) ? v : typeof v === "string" ? [v] : null;
      if (!picked) return "Pick an option.";
      if (picked.length > 1 && !field.multiple) return "Pick just one.";
      const labels = new Set((field.choices ?? []).map((c) => c.label));
      const others = picked.filter((p) => !labels.has(p));
      if (others.length > (field.allowOther ? 1 : 0)) return "Pick from the list.";
      if (others.some((o) => o.length > 500)) return "Keep it under 500 characters.";
      if (field.multiple && field.min && picked.length < field.min) return `Pick at least ${field.min}.`;
      if (field.multiple && field.max && picked.length > field.max) return `Pick up to ${field.max}.`;
      return null;
    }
    case "ranking": {
      const labels = (field.choices ?? []).map((c) => c.label).sort();
      return Array.isArray(v) && [...v].sort().join("\u0000") === labels.join("\u0000") ? null : "Please rank every item.";
    }
    case "file_upload": {
      const f = v as FileAnswer;
      return typeof f === "object" && f !== null && typeof f.fileId === "string" ? null : "Please upload a file.";
    }
  }
  return null;
}

export function scaleRange(field: Field): { start: number; end: number } {
  if (field.type === "nps") return { start: 0, end: 10 };
  if (field.type === "rating") return { start: 1, end: Math.min(Math.max(field.steps ?? 5, 3), 10) };
  const start = field.scaleStart ?? 1;
  return { start, end: start + Math.min(Math.max(field.steps ?? 5, 3), 11) - 1 };
}

/** Human-readable answer for display, exports and recall. */
export function displayValue(value: AnswerValue | undefined): string {
  return toText(value);
}

/** Replace {{ref}}, {{score}} and hidden-field keys inside question text. */
export function recall(text: string, ctx: Ctx): string {
  let missing = false;
  const out = text.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key: string) => {
    if (key === "score") return String(ctx.score);
    if (key in ctx.answers) return displayValue(ctx.answers[key]);
    if (key in ctx.hidden) return ctx.hidden[key];
    missing = true;
    return "";
  });
  // "Nice to meet you, {{name}}." with no name reads "Nice to meet you."
  if (!missing) return out;
  return out
    .replace(/\s*,\s*(?=[.!?,]|$)/g, "")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Question text for admin screens: tokens shown as [name]. */
export function plainText(text: string): string {
  return text.replace(/\{\{\s*([\w-]+)\s*\}\}/g, "[$1]");
}

/** Deterministic shuffle (so a choice list doesn't reshuffle on every render). */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** NPS = % promoters (9–10) minus % detractors (0–6). */
export function npsScore(values: number[]): number | null {
  if (values.length === 0) return null;
  const promoters = values.filter((v) => v >= 9).length;
  const detractors = values.filter((v) => v <= 6).length;
  return Math.round(((promoters - detractors) / values.length) * 100);
}

/** Problems a form author should know about before publishing. */
export function lintForm(form: Form): string[] {
  const problems: string[] = [];
  const refs = new Set<string>();
  form.fields.forEach((f, i) => {
    if (!f.title.trim()) problems.push(`Question ${i + 1} has no text.`);
    if (refs.has(f.ref)) problems.push(`Two questions share the key "${f.ref}".`);
    refs.add(f.ref);
    if (["multiple_choice", "picture_choice", "dropdown", "ranking"].includes(f.type) && !f.choices?.length)
      problems.push(`"${f.title || `Question ${i + 1}`}" has no options.`);
  });
  for (const rule of form.logic) {
    const from = form.fields.findIndex((f) => f.ref === rule.fromRef);
    if (from === -1) {
      problems.push("A logic rule starts from a question that no longer exists.");
      continue;
    }
    if (rule.goTo.startsWith("ending:")) {
      if (!form.endings.some((e) => `ending:${e.id}` === rule.goTo))
        problems.push(`A logic rule on "${form.fields[from].title}" points to a deleted ending.`);
      continue;
    }
    const to = form.fields.findIndex((f) => f.ref === rule.goTo);
    if (to === -1) problems.push(`A logic rule on "${form.fields[from].title}" points to a deleted question.`);
    else if (to <= from) problems.push(`A logic rule on "${form.fields[from].title}" jumps backwards, which would loop.`);
  }
  if (form.fields.filter(isQuestion).length === 0) problems.push("Add at least one question.");
  return problems;
}
