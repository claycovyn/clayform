// Small, validated edits to a form document, for the MCP server and anything else that edits forms one step at a
// time. Pure: each function takes a form and returns a new one (or throws FormOpError with a message a person or an
// AI agent can act on). Ids and keys are generated here, never trusted from the caller.
import { lintForm } from "./engine";
import { ToolError } from "./mcp-kit/tools";
import { blankForm, choice as makeChoice, FIELD_TYPES, newField, THEME_PRESETS, uid } from "./fields";
import { parseForm } from "./schema";
import type { Choice, Condition, Ending, Field, FieldType, Form, FormSettings, LogicRule, Operator, Theme, Welcome } from "./types";

/** A ToolError, so the MCP kit shows its message to the agent as-is. */
export class FormOpError extends ToolError {
  override name = "ToolError";
}

const REF_RE = /^[A-Za-z0-9_-]{1,40}$/;
const CHOICE_TYPES: FieldType[] = ["multiple_choice", "picture_choice", "dropdown", "ranking"];
export const OPERATORS: Operator[] = ["is", "is_not", "contains", "not_contains", "starts_with", "gt", "lt", "gte", "lte", "answered", "not_answered"];

/** Field properties a caller may set directly (everything else is managed here). */
export const FIELD_PROPERTIES = [
  "placeholder", "imageUrl", "multiple", "allowOther", "randomize", "steps", "scaleStart", "labels", "min", "max", "maxLength", "buttonLabel",
] as const;
type FieldProperty = (typeof FIELD_PROPERTIES)[number];
export type FieldProperties = Partial<Pick<Field, FieldProperty>>;

export type ChoiceInput = string | { label: string; score?: number; imageUrl?: string };

export interface FieldInput {
  type: FieldType;
  title: string;
  ref?: string;
  description?: string;
  required?: boolean;
  choices?: ChoiceInput[];
  properties?: FieldProperties;
  /** 0-based index to insert at; default: the end. */
  position?: number;
}

export interface FieldPatch {
  title?: string;
  /** Rename the key; logic rules that use it are updated too. */
  ref?: string;
  description?: string;
  required?: boolean;
  choices?: ChoiceInput[];
  properties?: FieldProperties;
}

export interface ConditionInput {
  /** A question key, "score", or "hidden:<name>". */
  source: string;
  op: Operator;
  value?: string | number | boolean;
}

export interface LogicInput {
  /** The question this rule runs after. */
  from: string;
  match?: "all" | "any";
  conditions: ConditionInput[];
  /** A question key to jump to, or "ending:<id>". */
  goTo: string;
}

export interface EndingInput {
  id?: string;
  title: string;
  description?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  redirectUrl?: string;
  minScore?: number;
  maxScore?: number;
}

export type SettingsPatch = Partial<Pick<FormSettings, "mode" | "showProgress" | "showQuestionNumbers" | "allowResume" | "closed" | "closedMessage" | "closeAt" | "responseLimit" | "branding">>;

export interface FormPatch {
  title?: string;
  slug?: string;
  welcome?: Partial<Welcome>;
  hiddenFields?: string[];
}

/** Validate against the schema and stamp updatedAt. Every op ends here. */
function finish(form: Form, now = new Date().toISOString()): Form {
  const next = { ...form, updatedAt: now };
  const parsed = parseForm(JSON.parse(JSON.stringify(next)));
  if (!parsed.ok) throw new FormOpError(parsed.error);
  return parsed.form;
}

function clone(form: Form): Form {
  return structuredClone(form);
}

function fieldIndex(form: Form, ref: string): number {
  const i = form.fields.findIndex((f) => f.ref === ref);
  if (i === -1) throw new FormOpError(`No question with key "${ref}". Keys in this form: ${form.fields.map((f) => f.ref).join(", ") || "(none)"}.`);
  return i;
}

function toChoices(input: ChoiceInput[]): Choice[] {
  if (input.length > 200) throw new FormOpError("A question can have at most 200 options.");
  return input.map((c) => {
    const { label, score, imageUrl } = typeof c === "string" ? { label: c, score: undefined, imageUrl: undefined } : c;
    if (!String(label ?? "").trim()) throw new FormOpError("Options need a label.");
    return makeChoice(String(label).trim(), { ...(score !== undefined ? { score } : {}), ...(imageUrl ? { imageUrl } : {}) });
  });
}

function pickProperties(props: FieldProperties | undefined): FieldProperties {
  if (!props) return {};
  const unknown = Object.keys(props).filter((k) => !(FIELD_PROPERTIES as readonly string[]).includes(k));
  if (unknown.length) throw new FormOpError(`Unknown properties: ${unknown.join(", ")}. Allowed: ${FIELD_PROPERTIES.join(", ")}.`);
  return props;
}

function checkRef(ref: string, form: Form, except?: string) {
  if (!REF_RE.test(ref)) throw new FormOpError(`"${ref}" isn't a valid key: use 1–40 letters, numbers, - or _.`);
  if (form.fields.some((f) => f.ref === ref && f.ref !== except)) throw new FormOpError(`Another question already uses the key "${ref}".`);
  if (ref === "score") throw new FormOpError(`"score" is reserved for the quiz score; pick another key.`);
}

// ---- Forms ---------------------------------------------------------------------------------------------------------

export function createForm(title: string, fields: FieldInput[] = []): Form {
  const clean = title.trim().slice(0, 200) || "Untitled form";
  let form = blankForm(clean);
  for (const f of fields) form = addField(form, f).form;
  return finish(form);
}

export function updateForm(form: Form, patch: FormPatch): Form {
  const next = clone(form);
  if (patch.title !== undefined) next.title = patch.title.trim().slice(0, 200) || next.title;
  if (patch.slug !== undefined) next.slug = patch.slug.trim().toLowerCase();
  if (patch.welcome) next.welcome = { ...next.welcome, ...patch.welcome };
  if (patch.hiddenFields) next.hiddenFields = [...new Set(patch.hiddenFields)];
  return finish(next);
}

// ---- Questions -----------------------------------------------------------------------------------------------------

export function addField(form: Form, input: FieldInput): { form: Form; field: Field } {
  if (!FIELD_TYPES.some((t) => t.type === input.type)) throw new FormOpError(`Unknown question type "${input.type}". Use list_field_types to see the 18 types.`);
  const next = clone(form);
  const field: Field = newField(input.type, next.fields);
  if (input.ref !== undefined) {
    checkRef(input.ref, next);
    field.ref = input.ref;
  }
  field.title = input.title;
  if (input.description !== undefined) field.description = input.description;
  if (input.required !== undefined) field.required = input.required;
  if (input.choices) {
    if (!CHOICE_TYPES.includes(input.type)) throw new FormOpError(`"${input.type}" questions don't take options.`);
    field.choices = toChoices(input.choices);
  }
  Object.assign(field, pickProperties(input.properties));
  const at = input.position === undefined ? next.fields.length : Math.max(0, Math.min(next.fields.length, Math.floor(input.position)));
  next.fields.splice(at, 0, field);
  const out = finish(next);
  return { form: out, field: out.fields.find((f) => f.id === field.id)! };
}

export function updateField(form: Form, ref: string, patch: FieldPatch): { form: Form; field: Field } {
  const next = clone(form);
  const i = fieldIndex(next, ref);
  const field = next.fields[i];
  if (patch.title !== undefined) field.title = patch.title;
  if (patch.description !== undefined) field.description = patch.description;
  if (patch.required !== undefined) field.required = patch.required;
  if (patch.choices) {
    if (!CHOICE_TYPES.includes(field.type)) throw new FormOpError(`"${field.type}" questions don't take options.`);
    field.choices = toChoices(patch.choices);
  }
  Object.assign(field, pickProperties(patch.properties));
  if (patch.ref !== undefined && patch.ref !== ref) {
    checkRef(patch.ref, next, ref);
    field.ref = patch.ref;
    next.logic = next.logic.map((r) => ({
      ...r,
      fromRef: r.fromRef === ref ? patch.ref! : r.fromRef,
      goTo: r.goTo === ref ? patch.ref! : r.goTo,
      conditions: r.conditions.map((c) => (c.source.kind === "field" && c.source.ref === ref ? { ...c, source: { kind: "field", ref: patch.ref! } } : c)),
    }));
  }
  const out = finish(next);
  return { form: out, field: out.fields[i] };
}

/** Removes the question and any logic rule that starts at, jumps to, or tests it. */
export function removeField(form: Form, ref: string): { form: Form; removedRules: number } {
  const next = clone(form);
  next.fields.splice(fieldIndex(next, ref), 1);
  const before = next.logic.length;
  next.logic = next.logic.filter((r) => r.fromRef !== ref && r.goTo !== ref && !r.conditions.some((c) => c.source.kind === "field" && c.source.ref === ref));
  return { form: finish(next), removedRules: before - next.logic.length };
}

/** `refs` must list every question exactly once, in the new order. */
export function reorderFields(form: Form, refs: string[]): Form {
  const have = form.fields.map((f) => f.ref);
  if (refs.length !== have.length || new Set(refs).size !== refs.length || !refs.every((r) => have.includes(r)))
    throw new FormOpError(`List every question key exactly once. Current keys: ${have.join(", ")}.`);
  const next = clone(form);
  next.fields = refs.map((r) => next.fields.find((f) => f.ref === r)!);
  assertLogicForward(next, next.logic);
  return finish(next);
}

// ---- Logic and endings ---------------------------------------------------------------------------------------------

function assertLogicForward(form: Form, rules: LogicRule[]) {
  for (const rule of rules) {
    const from = form.fields.findIndex((f) => f.ref === rule.fromRef);
    if (rule.goTo.startsWith("ending:")) continue;
    const to = form.fields.findIndex((f) => f.ref === rule.goTo);
    if (to !== -1 && to <= from) throw new FormOpError(`A rule after "${rule.fromRef}" would jump back to "${rule.goTo}", which loops. Logic can only jump forward.`);
  }
}

function toCondition(form: Form, c: ConditionInput): Condition {
  if (!OPERATORS.includes(c.op)) throw new FormOpError(`Unknown operator "${c.op}". Use one of: ${OPERATORS.join(", ")}.`);
  let source: Condition["source"];
  if (c.source === "score") source = { kind: "score" };
  else if (c.source.startsWith("hidden:")) {
    const key = c.source.slice(7);
    if (!form.hiddenFields.includes(key)) throw new FormOpError(`"${key}" isn't one of this form's hidden fields (${form.hiddenFields.join(", ") || "none"}).`);
    source = { kind: "hidden", key };
  } else {
    fieldIndex(form, c.source);
    source = { kind: "field", ref: c.source };
  }
  const needsValue = c.op !== "answered" && c.op !== "not_answered";
  if (needsValue && (c.value === undefined || c.value === "")) throw new FormOpError(`The "${c.op}" condition needs a value.`);
  return { source, op: c.op, ...(needsValue ? { value: String(c.value) } : {}) };
}

/** Replaces all logic rules. Every key and ending must exist, and jumps only go forward. */
export function setLogic(form: Form, rules: LogicInput[]): Form {
  const next = clone(form);
  next.logic = rules.map((r) => {
    fieldIndex(next, r.from);
    if (r.goTo.startsWith("ending:")) {
      if (!next.endings.some((e) => `ending:${e.id}` === r.goTo))
        throw new FormOpError(`No ending "${r.goTo}". Endings: ${next.endings.map((e) => `ending:${e.id}`).join(", ")}.`);
    } else fieldIndex(next, r.goTo);
    if (!r.conditions?.length) throw new FormOpError(`The rule after "${r.from}" needs at least one condition.`);
    return { id: uid(6), fromRef: r.from, match: r.match ?? "all", conditions: r.conditions.map((c) => toCondition(next, c)), goTo: r.goTo };
  });
  assertLogicForward(next, next.logic);
  return finish(next);
}

/** Replaces the endings. Keep an ending's id to keep logic that points at it; at least one is required. */
export function setEndings(form: Form, endings: EndingInput[]): Form {
  if (!endings.length) throw new FormOpError("A form needs at least one ending.");
  const next = clone(form);
  const seen = new Set<string>();
  next.endings = endings.map((e): Ending => {
    const id = e.id && /^[A-Za-z0-9_-]{1,40}$/.test(e.id) && !seen.has(e.id) ? e.id : uid(6);
    seen.add(id);
    const { id: _ignored, ...rest } = e;
    return { ...rest, id };
  });
  const orphan = next.logic.find((r) => r.goTo.startsWith("ending:") && !next.endings.some((e) => `ending:${e.id}` === r.goTo));
  if (orphan) throw new FormOpError(`A logic rule after "${orphan.fromRef}" goes to ${orphan.goTo}. Keep that ending's id, or change the rule with set_logic first.`);
  return finish(next);
}

// ---- Look and settings ---------------------------------------------------------------------------------------------

export const THEME_PRESET_NAMES = THEME_PRESETS.map((t) => t.preset);

/** Start from a preset (by name) and/or override individual theme values. */
export function setTheme(form: Form, input: { preset?: string } & Partial<Omit<Theme, "preset">>): Form {
  const next = clone(form);
  const { preset, ...overrides } = input;
  if (preset !== undefined) {
    const p = THEME_PRESETS.find((t) => t.preset.toLowerCase() === preset.toLowerCase());
    if (!p) throw new FormOpError(`No theme called "${preset}". Presets: ${THEME_PRESET_NAMES.join(", ")}.`);
    next.theme = { ...p, ...(next.theme.backgroundImage ? { backgroundImage: next.theme.backgroundImage } : {}) };
  }
  next.theme = { ...next.theme, ...overrides };
  if (Object.keys(overrides).length && preset === undefined) next.theme.preset = "Custom";
  return finish(next);
}

const SETTINGS_KEYS = ["mode", "showProgress", "showQuestionNumbers", "allowResume", "closed", "closedMessage", "closeAt", "responseLimit", "branding"];

export function updateSettings(form: Form, patch: SettingsPatch): Form {
  const unknown = Object.keys(patch).filter((k) => !SETTINGS_KEYS.includes(k));
  if (unknown.length) throw new FormOpError(`Unknown settings: ${unknown.join(", ")}. Webhooks are set with set_webhook.`);
  if (patch.closeAt && Number.isNaN(Date.parse(patch.closeAt))) throw new FormOpError("closeAt must be an ISO date and time.");
  const next = clone(form);
  next.settings = { ...next.settings, ...patch };
  if (patch.closeAt === "") delete next.settings.closeAt;
  return finish(next);
}

export function setWebhook(form: Form, url: string | null, secret?: string | null): Form {
  const next = clone(form);
  if (url) next.settings.webhookUrl = url;
  else delete next.settings.webhookUrl;
  if (secret) next.settings.webhookSecret = secret;
  else if (secret === null || !url) delete next.settings.webhookSecret;
  return finish(next);
}

// ---- Publishing ----------------------------------------------------------------------------------------------------

/** Publishing refuses a form with problems (no questions, empty titles, broken logic…) and lists them. */
export function publish(form: Form): Form {
  const problems = lintForm(form);
  if (problems.length) throw new FormOpError(`Fix these before publishing: ${problems.join(" ")}`);
  return finish({ ...clone(form), status: "published" });
}

export function unpublish(form: Form): Form {
  return finish({ ...clone(form), status: "draft" });
}

// ---- Reference -----------------------------------------------------------------------------------------------------

/** What each question type is and which options it takes, so agents build valid forms. */
export function fieldTypeGuide() {
  const extra: Partial<Record<FieldType, string>> = {
    short_text: "properties: placeholder, maxLength",
    long_text: "properties: placeholder, maxLength",
    number: "properties: min, max, placeholder",
    multiple_choice: "choices (required); properties: multiple, allowOther, randomize. Choices may carry a score for quizzes.",
    picture_choice: "choices with imageUrl; properties: multiple, randomize",
    dropdown: "choices (required); properties: randomize",
    ranking: "choices (required) to put in order; properties: randomize",
    rating: "properties: steps (3–10, default 5)",
    opinion_scale: "properties: steps (3–11), scaleStart (0 or 1), labels {left, right}",
    nps: "0–10; properties: labels {left, right}",
    legal: "a consent checkbox; usually required",
    statement: "text between questions, no answer; properties: buttonLabel",
    file_upload: "stored on the server; download with get_file",
  };
  return FIELD_TYPES.map((t) => ({ type: t.type, label: t.label, group: t.group, hint: t.hint, options: extra[t.type] ?? null }));
}
