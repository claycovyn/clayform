// Validation for forms coming from the builder or a JSON import.
import { z } from "zod";
import type { Form } from "./types";

const str = (max: number) => z.string().max(max);
const color = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);
const ref = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Keys can use letters, numbers, - and _.");
const httpUrl = z
  .string()
  .max(2000)
  .refine((v) => v === "" || /^https?:\/\//i.test(v), "Links must start with http:// or https://");

const choice = z.object({
  id: str(40),
  label: str(300),
  score: z.number().finite().optional(),
  imageUrl: httpUrl.optional(),
});

const field = z.object({
  id: str(40),
  ref,
  type: z.enum([
    "short_text", "long_text", "email", "phone", "number", "url", "multiple_choice", "picture_choice",
    "dropdown", "yes_no", "rating", "opinion_scale", "nps", "date", "legal", "ranking", "file_upload", "statement",
  ]),
  title: str(1000),
  description: str(4000).optional(),
  required: z.boolean().optional(),
  placeholder: str(200).optional(),
  imageUrl: httpUrl.optional(),
  choices: z.array(choice).max(200).optional(),
  multiple: z.boolean().optional(),
  allowOther: z.boolean().optional(),
  randomize: z.boolean().optional(),
  steps: z.number().int().min(3).max(11).optional(),
  scaleStart: z.number().int().min(0).max(1).optional(),
  labels: z.object({ left: str(60).optional(), right: str(60).optional() }).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  maxLength: z.number().int().positive().max(100000).optional(),
  buttonLabel: str(60).optional(),
});

const condition = z.object({
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("field"), ref }),
    z.object({ kind: z.literal("score") }),
    z.object({ kind: z.literal("hidden"), key: ref }),
  ]),
  op: z.enum(["is", "is_not", "contains", "not_contains", "starts_with", "gt", "lt", "gte", "lte", "answered", "not_answered"]),
  value: str(500).optional(),
});

export const formSchema = z.object({
  id: str(40),
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/, "Links use lowercase letters, numbers and dashes (3–60)."),
  title: str(200),
  status: z.enum(["draft", "published"]),
  welcome: z.object({
    enabled: z.boolean(),
    title: str(1000),
    description: str(4000).optional(),
    buttonLabel: str(60),
    imageUrl: httpUrl.optional(),
  }),
  fields: z.array(field).max(500),
  logic: z
    .array(
      z.object({
        id: str(40),
        fromRef: ref,
        match: z.enum(["all", "any"]),
        conditions: z.array(condition).max(50),
        goTo: str(60),
      }),
    )
    .max(1000),
  endings: z
    .array(
      z.object({
        id: str(40),
        title: str(1000),
        description: str(4000).optional(),
        buttonLabel: str(60).optional(),
        buttonUrl: httpUrl.optional(),
        redirectUrl: httpUrl.optional(),
        minScore: z.number().finite().optional(),
        maxScore: z.number().finite().optional(),
      }),
    )
    .min(1)
    .max(50),
  hiddenFields: z.array(ref).max(50),
  theme: z.object({
    preset: str(40),
    bg: color,
    text: color,
    accent: color,
    buttonText: color,
    font: z.enum(["sans", "serif", "rounded", "mono", "display"]),
    radius: z.number().min(0).max(40),
    backgroundImage: httpUrl.optional(),
    align: z.enum(["left", "center"]),
  }),
  settings: z.object({
    mode: z.enum(["conversational", "classic"]),
    showProgress: z.boolean(),
    showQuestionNumbers: z.boolean(),
    allowResume: z.boolean(),
    closed: z.boolean(),
    closedMessage: str(500),
    closeAt: z.string().max(40).optional(),
    responseLimit: z.number().int().positive().optional(),
    webhookUrl: httpUrl.optional(),
    webhookSecret: str(200).optional(),
    branding: z.boolean(),
  }),
  createdAt: str(40),
  updatedAt: str(40),
});

export function parseForm(input: unknown): { ok: true; form: Form } | { ok: false; error: string } {
  const result = formSchema.safeParse(input);
  if (result.success) return { ok: true, form: result.data as Form };
  const issue = result.error.issues[0];
  return { ok: false, error: `${issue.path.join(".") || "form"}: ${issue.message}` };
}
