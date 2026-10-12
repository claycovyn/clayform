// Clayform's MCP server: lets an AI agent (Grok, Claude, ChatGPT…) build forms, publish them and read results on
// someone's behalf, using one of their API keys. A fresh server is created per request (stateless HTTP), bound to
// the key's owner and scopes, so a tool can only ever see that person's forms.
import "server-only";
import { z, type ZodRawShape } from "zod";
import type { Caller } from "../api";
import { defineTool, ToolError, type ToolContext, type ToolDef } from "../mcp-kit";
import { responsesToCsv } from "../csv";
import { deleteForm, deleteResponses, formOwner, formStats, getFile, getOwnedForm, getResponse, listForms, listResponses, queryResponses, saveForm, slugTaken } from "../db";
import { signedFileUrl } from "../fileLinks";
import { uid } from "../fields";
import {
  addField,
  createForm,
  fieldTypeGuide,
  FIELD_PROPERTIES,
  FormOpError,
  OPERATORS,
  publish,
  removeField,
  reorderFields,
  setEndings,
  setLogic,
  setTheme,
  setWebhook,
  THEME_PRESET_NAMES,
  unpublish,
  updateField,
  updateForm,
  updateSettings,
} from "../formOps";
import { lintForm } from "../engine";
import { publishRefusal } from "../abuse";
import { cloudEnabled } from "../plans";
import { webhookBlocked } from "../netguard";
import { summarize } from "../stats";
import { deliverWebhook } from "../submit";
import type { Form, ResponseRecord } from "../types";
import pkg from "../../../package.json";

export const SERVER_NAME = "clayform";
export const SERVER_VERSION = pkg.version;

export const INSTRUCTIONS = `Clayform builds conversational forms (one question at a time) and collects responses.
Typical flow: create_form → add_field (repeat; call list_field_types first if unsure) → optional set_logic / set_endings / set_theme → publish_form → get_share_links to give the person the public link.
Every question has a short "ref" key used by logic, exports and webhooks. Forms are private drafts until published.
Results: list_responses (paged with cursor), get_stats, export_responses. Destructive tools (delete_form, delete_responses) can't be undone: confirm with the person first.`;

type Ctx = ToolContext<Caller>;
const tool = defineTool<Caller>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function t<S extends ZodRawShape>(name: string, opts: Omit<ToolDef<Caller, S>, "name" | "run">, run: ToolDef<Caller, S>["run"]): ToolDef<Caller, any> {
  return tool({ name, ...opts, run });
}

// ---- Input schemas ---------------------------------------------------------------------------------------------------

const fieldTypes = z.enum([
  "short_text", "long_text", "email", "phone", "number", "url", "multiple_choice", "picture_choice", "dropdown", "yes_no",
  "rating", "opinion_scale", "nps", "date", "legal", "ranking", "file_upload", "statement",
]);
const choiceInput = z.union([z.string(), z.object({ label: z.string(), score: z.number().optional(), imageUrl: z.string().optional() })]);
const properties = z
  .object({
    placeholder: z.string().optional(),
    imageUrl: z.string().optional(),
    multiple: z.boolean().optional(),
    allowOther: z.boolean().optional(),
    randomize: z.boolean().optional(),
    steps: z.number().int().optional(),
    scaleStart: z.number().int().optional(),
    labels: z.object({ left: z.string().optional(), right: z.string().optional() }).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    maxLength: z.number().int().optional(),
    buttonLabel: z.string().optional(),
  })
  .strict()
  .describe(`Type-specific options: ${FIELD_PROPERTIES.join(", ")}.`);
const fieldInput = z.object({
  type: fieldTypes,
  title: z.string().describe("The question as the respondent sees it. {{ref}} recalls an earlier answer."),
  ref: z.string().optional().describe("Short key (letters, numbers, - _). Generated if omitted."),
  description: z.string().optional(),
  required: z.boolean().optional(),
  choices: z.array(choiceInput).optional().describe("Options for multiple_choice, picture_choice, dropdown, ranking."),
  properties: properties.optional(),
});
const formId = z.string().describe("The form's id (from list_forms or create_form).");

// ---- Helpers -----------------------------------------------------------------------------------------------------------

/** What an agent needs about a form without the whole document. */
function formSummary(form: Form) {
  return {
    id: form.id,
    title: form.title,
    status: form.status,
    slug: form.slug,
    questions: form.fields.map((f) => ({ ref: f.ref, type: f.type, title: f.title, required: !!f.required })),
    logicRules: form.logic.length,
    endings: form.endings.map((e) => ({ id: e.id, title: e.title })),
    updatedAt: form.updatedAt,
  };
}

function shareLinks(form: Form, origin: string) {
  const url = `${origin}/f/${form.slug}`;
  return {
    status: form.status,
    url,
    ...(form.status !== "published" ? { note: "This form is a draft: the link shows a 'not available' page until you publish_form." } : {}),
    embed: {
      inline: `<div data-clayform="${form.slug}" style="width:100%;height:560px"></div>\n<script src="${origin}/embed.js" async></script>`,
      popup: `<button data-clayform-popup="${form.slug}">Open the form</button>\n<script src="${origin}/embed.js" async></script>`,
      iframe: `<iframe src="${url}?embed=1" title="${form.title.replace(/"/g, "&quot;")}" style="border:0;width:100%;height:560px"></iframe>`,
    },
  };
}

/** Responses with file answers turned into short-lived download links. */
function withFileLinks(r: ResponseRecord, origin: string) {
  const answers = Object.fromEntries(
    Object.entries(r.answers).map(([k, v]) =>
      v && typeof v === "object" && !Array.isArray(v) && "fileId" in v ? [k, { ...v, download: signedFileUrl(origin, v.fileId).url }] : [k, v],
    ),
  );
  return { ...r, answers };
}

// ---- Server ------------------------------------------------------------------------------------------------------------

const owned = async (c: Ctx, id: string): Promise<Form> => {
    const form = await getOwnedForm(id, c.context.user.id);
    if (!form) throw new ToolError(`No form with id "${id}" in this account. Use list_forms to see your forms.`);
    return form;
  };
/** Validate, keep the slug unique and save. */
const save = async (c: Ctx, form: Form): Promise<Form> => {
    if (await slugTaken(form.slug, form.id)) throw new ToolError(`The link "${form.slug}" is already used by another form.`);
    const refusal = cloudEnabled() && form.status === "published" ? publishRefusal(form) : null;
    if (refusal) throw new ToolError(refusal);
    await saveForm(form, c.context.user.id);
    return form;
};
const edited = (form: Form) => ({ form: formSummary(form), warnings: lintForm(form) });

export const TOOLS: ToolDef<Caller, any>[] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
  // ---- Meta ----
  t("list_field_types", { title: "List question types", description: "The 18 question types and the options each takes. Call this before building a form.", scope: null, input: {}, readOnly: true }, async (_args, c) => ({
    types: fieldTypeGuide(),
    logicOperators: OPERATORS,
    themePresets: THEME_PRESET_NAMES,
  })),

  // ---- Forms ----
  t("list_forms", { title: "List forms", description: "Every form in this account with its status and response counts.", scope: "forms:read", input: {}, readOnly: true }, async (_args, c) => ({
    forms: (await listForms(c.context.user.id)).map((f) => ({ id: f.id, title: f.title, status: f.status, questions: f.fields.length, views: f.stats.views, starts: f.stats.starts, completes: f.stats.completes, updatedAt: f.updatedAt })),
  })),

  t("get_form", { title: "Get a form", description: "The full form document: questions, logic, endings, theme and settings (webhook secret hidden).", scope: "forms:read", input: { form_id: formId }, readOnly: true }, async ({ form_id }, c) => {
    const form = await owned(c, form_id);
    return { form: { ...form, settings: { ...form.settings, ...(form.settings.webhookSecret ? { webhookSecret: "(set)" } : {}) } } };
  }),

  t(
    "create_form",
    { title: "Create a form", description: "Creates a draft form, optionally with its first questions.", scope: "forms:write", input: { title: z.string(), fields: z.array(fieldInput).optional() } },
    async ({ title, fields }, c) => {
      const form = createForm(title, fields);
      while (await slugTaken(form.slug)) form.slug = uid(8);
      return edited(await save(c, form));
    },
  ),

  t(
    "update_form",
    {
      title: "Update a form",
      description: "Change the title, the link slug, the welcome screen or the hidden fields (values passed in the link, like ?source=ad).",
      scope: "forms:write",
      input: {
        form_id: formId,
        title: z.string().optional(),
        slug: z.string().optional().describe("Lowercase letters, numbers and dashes, 3–60."),
        welcome: z.object({ enabled: z.boolean().optional(), title: z.string().optional(), description: z.string().optional(), buttonLabel: z.string().optional(), imageUrl: z.string().optional() }).optional(),
        hidden_fields: z.array(z.string()).optional(),
      },
      idempotent: true,
    },
    async ({ form_id, title, slug, welcome, hidden_fields }, c) => edited(await save(c, updateForm(await owned(c, form_id), { title, slug, welcome, hiddenFields: hidden_fields }))),
  ),

  t(
    "delete_form",
    { title: "Delete a form", description: "Permanently deletes the form, all of its responses and uploaded files. Can't be undone: confirm with the person first.", scope: "forms:write", input: { form_id: formId }, destructive: true },
    async ({ form_id }, c) => {
      const form = await owned(c, form_id);
      await deleteForm(form.id);
      return { deleted: form.id, title: form.title };
    },
  ),

  // ---- Builder ----
  t(
    "add_field",
    { title: "Add a question", description: "Adds a question to a form (at the end, or at `position`).", scope: "forms:write", input: { form_id: formId, ...fieldInput.shape, position: z.number().int().min(0).optional() } },
    async ({ form_id, ...input }, c) => {
      const { form, field } = addField(await owned(c, form_id), input);
      return { field, ...edited(await save(c, form)) };
    },
  ),

  t(
    "update_field",
    {
      title: "Update a question",
      description: "Edit a question by its ref. Passing `choices` replaces all options. Changing `ref` updates logic that uses it.",
      scope: "forms:write",
      input: {
        form_id: formId,
        ref: z.string(),
        patch: z.object({ title: z.string().optional(), ref: z.string().optional(), description: z.string().optional(), required: z.boolean().optional(), choices: z.array(choiceInput).optional(), properties: properties.optional() }),
      },
      idempotent: true,
    },
    async ({ form_id, ref, patch }, c) => {
      const { form, field } = updateField(await owned(c, form_id), ref, patch);
      return { field, ...edited(await save(c, form)) };
    },
  ),

  t(
    "remove_field",
    { title: "Remove a question", description: "Removes a question and any logic rule that uses it. Existing answers stay in past responses.", scope: "forms:write", input: { form_id: formId, ref: z.string() }, destructive: true },
    async ({ form_id, ref }, c) => {
      const { form, removedRules } = removeField(await owned(c, form_id), ref);
      return { removedRules, ...edited(await save(c, form)) };
    },
  ),

  t(
    "reorder_fields",
    { title: "Reorder questions", description: "Pass every question ref once, in the new order.", scope: "forms:write", input: { form_id: formId, refs: z.array(z.string()) }, idempotent: true },
    async ({ form_id, refs }, c) => edited(await save(c, reorderFields(await owned(c, form_id), refs))),
  ),

  t(
    "set_logic",
    {
      title: "Set logic jumps",
      description: `Replaces all logic rules. After the respondent answers \`from\`, if the conditions match, jump to \`go_to\` (a later question's ref, or "ending:<id>"). Condition source: a question ref, "score", or "hidden:<name>". Operators: ${OPERATORS.join(", ")}. Pass [] to clear.`,
      scope: "forms:write",
      input: {
        form_id: formId,
        rules: z.array(
          z.object({
            from: z.string(),
            match: z.enum(["all", "any"]).optional(),
            conditions: z.array(z.object({ source: z.string(), op: z.enum(OPERATORS as [string, ...string[]]), value: z.union([z.string(), z.number(), z.boolean()]).optional() })),
            go_to: z.string(),
          }),
        ),
      },
      idempotent: true,
    },
    async ({ form_id, rules }, c) =>
      edited(await save(c, setLogic(await owned(c, form_id), rules.map((r) => ({ from: r.from, match: r.match, conditions: r.conditions as never, goTo: r.go_to }))))),
  ),

  t(
    "set_endings",
    {
      title: "Set endings",
      description: "Replaces the thank-you screens. Keep an ending's id to keep logic that points at it. Use min_score/max_score for quiz results.",
      scope: "forms:write",
      input: {
        form_id: formId,
        endings: z.array(
          z.object({
            id: z.string().optional(),
            title: z.string(),
            description: z.string().optional(),
            button_label: z.string().optional(),
            button_url: z.string().optional(),
            redirect_url: z.string().optional(),
            min_score: z.number().optional(),
            max_score: z.number().optional(),
          }),
        ),
      },
      idempotent: true,
    },
    async ({ form_id, endings }, c) =>
      edited(
        await save(c, 
          setEndings(
            await owned(c, form_id),
            endings.map((e) => ({ id: e.id, title: e.title, description: e.description, buttonLabel: e.button_label, buttonUrl: e.button_url, redirectUrl: e.redirect_url, minScore: e.min_score, maxScore: e.max_score })),
          ),
        ),
      ),
  ),

  t(
    "set_theme",
    {
      title: "Set the look",
      description: `Start from a preset (${THEME_PRESET_NAMES.join(", ")}) and/or set colors (#hex), font (sans, serif, rounded, mono, display), radius (0–40), align (left, center), background_image (https URL).`,
      scope: "forms:write",
      input: {
        form_id: formId,
        preset: z.string().optional(),
        bg: z.string().optional(),
        text: z.string().optional(),
        accent: z.string().optional(),
        button_text: z.string().optional(),
        font: z.enum(["sans", "serif", "rounded", "mono", "display"]).optional(),
        radius: z.number().optional(),
        align: z.enum(["left", "center"]).optional(),
        background_image: z.string().optional(),
      },
      idempotent: true,
    },
    async ({ form_id, button_text, background_image, ...rest }, c) => {
      const input = Object.fromEntries(Object.entries({ ...rest, buttonText: button_text, backgroundImage: background_image }).filter(([, v]) => v !== undefined));
      return edited(await save(c, setTheme(await owned(c, form_id), input)));
    },
  ),

  // ---- Publish ----
  t(
    "update_settings",
    {
      title: "Update settings",
      description: "mode (conversational | classic), show_progress, show_question_numbers, allow_resume, closed, closed_message, close_at (ISO time, \"\" to clear), response_limit, branding.",
      scope: "forms:write",
      input: {
        form_id: formId,
        mode: z.enum(["conversational", "classic"]).optional(),
        show_progress: z.boolean().optional(),
        show_question_numbers: z.boolean().optional(),
        allow_resume: z.boolean().optional(),
        closed: z.boolean().optional(),
        closed_message: z.string().optional(),
        close_at: z.string().optional(),
        response_limit: z.number().int().positive().nullable().optional().describe("null removes the limit."),
        branding: z.boolean().optional(),
      },
      idempotent: true,
    },
    async ({ form_id, ...s }, c) => {
      const form = await owned(c, form_id);
      const patch = Object.fromEntries(
        Object.entries({
          mode: s.mode,
          showProgress: s.show_progress,
          showQuestionNumbers: s.show_question_numbers,
          allowResume: s.allow_resume,
          closed: s.closed,
          closedMessage: s.closed_message,
          closeAt: s.close_at,
          responseLimit: s.response_limit ?? undefined,
          branding: s.branding,
        }).filter(([, v]) => v !== undefined),
      );
      let next = updateSettings(form, patch);
      if (s.response_limit === null) {
        next = structuredClone(next);
        delete next.settings.responseLimit;
      }
      return { settings: { ...next.settings, webhookSecret: undefined }, ...edited(await save(c, next)) };
    },
  ),

  t(
    "publish_form",
    { title: "Publish a form", description: "Makes the form live at its public link. Refuses (and lists what to fix) if the form has problems.", scope: "forms:write", input: { form_id: formId }, idempotent: true },
    async ({ form_id }, c) => {
      const form = await save(c, publish(await owned(c, form_id)));
      return { published: true, ...shareLinks(form, c.origin) };
    },
  ),

  t(
    "unpublish_form",
    { title: "Unpublish a form", description: "Takes the form offline (back to draft). Responses are kept.", scope: "forms:write", input: { form_id: formId }, idempotent: true },
    async ({ form_id }, c) => {
      await save(c, unpublish(await owned(c, form_id)));
      return { published: false };
    },
  ),

  t("get_share_links", { title: "Get share links", description: "The public link and embed snippets (inline, popup, iframe).", scope: "forms:read", input: { form_id: formId }, readOnly: true }, async ({ form_id }, c) =>
    shareLinks(await owned(c, form_id), c.origin),
  ),

  // ---- Results ----
  t(
    "list_responses",
    {
      title: "List responses",
      description: "Newest first. Page with `cursor` (from next_cursor). Uploaded files come with a download link valid for 15 minutes.",
      scope: "responses:read",
      input: {
        form_id: formId,
        completed_only: z.boolean().optional().describe("Only finished responses (default: include partial ones)."),
        since: z.string().optional().describe("ISO time: only responses updated at or after it."),
        limit: z.number().int().min(1).max(100).optional().describe("Default 25."),
        cursor: z.string().optional(),
      },
      readOnly: true,
    },
    async ({ form_id, completed_only, since, limit, cursor }, c) => {
      const form = await owned(c, form_id);
      if (since && Number.isNaN(Date.parse(since))) throw new ToolError("since must be an ISO date or time, like 2026-10-01T00:00:00Z.");
      const page = await queryResponses(form.id, { limit: limit ?? 25, cursor, since, completedOnly: completed_only });
      return {
        questions: form.fields.map((f) => ({ ref: f.ref, title: f.title })),
        responses: page.responses.map((r) => withFileLinks(r, c.origin)),
        next_cursor: page.nextCursor,
      };
    },
  ),

  t("get_response", { title: "Get a response", description: "One response by id.", scope: "responses:read", input: { response_id: z.string() }, readOnly: true }, async ({ response_id }, c) => {
    const found = await getResponse(response_id);
    if (!found || (await formOwner(found.response.formId)) !== c.context.user.id) throw new ToolError(`No response with id "${response_id}" in this account.`);
    return { response: withFileLinks(found.response, c.origin) };
  }),

  t(
    "get_stats",
    { title: "Get results summary", description: "Views, starts, completions, completion rate, average time, drop-off per question and NPS.", scope: "responses:read", input: { form_id: formId }, readOnly: true },
    async ({ form_id }, c) => {
      const form = await owned(c, form_id);
      return { title: form.title, ...summarize(form, await formStats(form.id), await listResponses(form.id)) };
    },
  ),

  t(
    "export_responses",
    {
      title: "Export responses",
      description: "All responses as CSV (opens in Excel) or JSON. Large exports are cut off; use list_responses to page instead.",
      scope: "responses:read",
      input: { form_id: formId, format: z.enum(["csv", "json"]), status: z.enum(["all", "complete", "partial"]).optional() },
      readOnly: true,
    },
    async ({ form_id, format, status }, c) => {
      const form = await owned(c, form_id);
      const all = await listResponses(form.id);
      const rows = all.filter((r) => (status === "complete" ? r.completedAt : status === "partial" ? !r.completedAt : true));
      const body = format === "csv" ? responsesToCsv(form, rows, (id) => signedFileUrl(c.origin, id).url) : JSON.stringify(rows.map((r) => withFileLinks(r, c.origin)));
      const MAX = 900_000;
      return { format, count: rows.length, truncated: body.length > MAX, data: body.slice(0, MAX) };
    },
  ),

  t(
    "delete_responses",
    { title: "Delete responses", description: "Permanently deletes the given responses. Can't be undone: confirm with the person first.", scope: "responses:delete", input: { form_id: formId, ids: z.array(z.string()).min(1).max(500) }, destructive: true },
    async ({ form_id, ids }, c) => {
      const form = await owned(c, form_id);
      await deleteResponses(form.id, ids);
      return { deleted: ids.length };
    },
  ),

  t("get_file", { title: "Get an uploaded file", description: "A download link (valid 15 minutes) for a file someone uploaded to one of your forms.", scope: "responses:read", input: { file_id: z.string() }, readOnly: true }, async ({ file_id }, c) => {
    const file = await getFile(file_id);
    if (!file || (await formOwner(file.formId)) !== c.context.user.id) throw new ToolError(`No file with id "${file_id}" in this account.`);
    return { name: file.name, type: file.type, size: file.size, ...signedFileUrl(c.origin, file.id) };
  }),

  // ---- Webhooks ----
  t(
    "set_webhook",
    {
      title: "Set the webhook",
      description: "Clayform POSTs each completed response to this https URL, signed with the secret (X-Clayform-Signature) if one is set. Pass url: null to remove it.",
      scope: "webhooks:write",
      input: { form_id: formId, url: z.string().nullable(), secret: z.string().max(200).nullable().optional() },
      idempotent: true,
    },
    async ({ form_id, url, secret }, c) => {
      if (url) {
        const blocked = await webhookBlocked(url);
        if (blocked) throw new ToolError(`That webhook URL can't be used: ${blocked}`);
      }
      const form = await save(c, setWebhook(await owned(c, form_id), url, secret));
      return { webhookUrl: form.settings.webhookUrl ?? null, signed: !!form.settings.webhookSecret };
    },
  ),

  t("test_webhook", { title: "Test the webhook", description: "Sends a sample response to the form's webhook and reports what the endpoint answered.", scope: "webhooks:write", input: { form_id: formId } }, async ({ form_id }, c) => {
    const form = await owned(c, form_id);
    if (!form.settings.webhookUrl) throw new ToolError("This form has no webhook. Set one with set_webhook first.");
    const now = new Date().toISOString();
    const sample: ResponseRecord = { id: "test_response", formId: form.id, answers: Object.fromEntries(form.fields.map((f) => [f.ref, "sample answer"])), hidden: {}, score: 0, startedAt: now, updatedAt: now, completedAt: now, meta: {} };
    return deliverWebhook(form, sample);
  }),

];
