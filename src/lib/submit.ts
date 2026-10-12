// Server side of answering a form: partial saves, resume, completion, webhooks.
import "server-only";
import crypto from "node:crypto";
import { computeScore, fieldByRef, isEmpty, isQuestion, resolvePath, validateAnswer } from "./engine";
import { formOwner, formStats, getFile, getResponse, getTakedown, saveResponse } from "./db";
import { meter, newResponsesPaused, PAUSED_MESSAGE } from "./plans";
import { rateLimited } from "./rateLimit";
import { hash } from "./auth";
import { uid } from "./fields";
import { webhookBlocked } from "./netguard";
import type { AnswerValue, Answers, Form, ResponseRecord } from "./types";

export interface SubmitBody {
  responseId?: string;
  resumeToken?: string;
  answers?: Record<string, unknown>;
  hidden?: Record<string, unknown>;
  lastRef?: string;
  complete?: boolean;
  startedAt?: string;
  /** Honeypot. Real people never fill it in. */
  website?: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string; ref?: string };

export const TAKEN_DOWN_MESSAGE = "This form was removed for breaking Clayform's rules.";

export async function closedReason(form: Form): Promise<string | null> {
  if (await getTakedown(form.id)) return TAKEN_DOWN_MESSAGE;
  if (form.status !== "published" || form.settings.closed) return form.settings.closedMessage;
  if (form.settings.closeAt && Date.parse(form.settings.closeAt) < Date.now()) return form.settings.closedMessage;
  if (form.settings.responseLimit && await (await formStats(form.id)).completes >= form.settings.responseLimit)
    return form.settings.closedMessage;
  return null;
}

async function coerce(form: Form, raw: Record<string, unknown>): Promise<Answers> {
  const out: Answers = {};
  for (const [ref, value] of Object.entries(raw)) {
    const field = fieldByRef(form, ref);
    if (!field || !isQuestion(field)) continue;
    let v: AnswerValue = null;
    if (typeof value === "string") v = value.slice(0, 20000);
    else if (typeof value === "number" || typeof value === "boolean") v = value;
    else if (Array.isArray(value)) v = value.filter((x): x is string => typeof x === "string").slice(0, 200).map((x) => x.slice(0, 500));
    else if (value && typeof value === "object" && field.type === "file_upload") {
      const file = await getFile(String((value as { fileId?: unknown }).fileId ?? ""));
      if (file && file.formId === form.id) v = { fileId: file.id, name: file.name, size: file.size, type: file.type };
    }
    if (field.type === "email" && typeof v === "string") v = v.trim();
    if (isEmpty(v) || validateAnswer(field, v)) continue;
    out[ref] = v;
  }
  return out;
}

function cleanHidden(form: Form, raw: Record<string, unknown> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of form.hiddenFields) {
    const v = raw[key];
    if (typeof v === "string" && v) out[key] = v.slice(0, 500);
  }
  return out;
}

export async function submit(
  form: Form,
  body: SubmitBody,
  meta: { userAgent?: string; referrer?: string },
): Promise<Result<{ responseId: string; resumeToken?: string; endingId?: string; score: number }>> {
  const closed = await closedReason(form);
  if (closed) return { ok: false, status: 403, error: closed };

  if (body.website) return { ok: true, data: { responseId: uid(), score: 0 } };

  let existing: ResponseRecord | null = null;
  if (body.responseId) {
    const found = await getResponse(body.responseId);
    if (!found || found.response.formId !== form.id || !body.resumeToken || hash(body.resumeToken) !== found.resumeHash)
      return { ok: false, status: 404, error: "That response link isn't valid any more." };
    existing = found.response;
    if (existing.completedAt)
      return { ok: true, data: { responseId: existing.id, endingId: existing.endingId, score: existing.score } };
  }

  const ownerId = await formOwner(form.id);
  if (!existing) {
    // A brand-new respondent: respect the workspace's plan limit and a per-workspace flood guard.
    if (await newResponsesPaused(ownerId)) return { ok: false, status: 403, error: PAUSED_MESSAGE };
    if (ownerId && rateLimited(`workspace:${ownerId}`, 300)) return { ok: false, status: 429, error: "This form is very busy. Try again in a minute." };
  }

  const answers: Answers = { ...(existing?.answers ?? {}), ...(await coerce(form, body.answers ?? {})) };
  // Answers the respondent cleared on the way back are removed.
  for (const [ref, value] of Object.entries(body.answers ?? {})) if (value === null) delete answers[ref];
  const hidden = existing?.hidden ?? cleanHidden(form, body.hidden);
  const now = new Date().toISOString();
  const score = computeScore(form, answers);
  const ctx = { answers, hidden, score };

  let completedAt: string | null = null;
  let endingId: string | undefined;
  if (body.complete) {
    const path = resolvePath(form, ctx);
    for (const ref of path.refs) {
      const field = fieldByRef(form, ref)!;
      const error = validateAnswer(field, answers[ref]);
      if (error) return { ok: false, status: 422, error, ref };
    }
    // Answers from branches the respondent didn't end up on are dropped.
    const onPath = new Set(path.refs);
    for (const ref of Object.keys(answers)) if (!onPath.has(ref)) delete answers[ref];
    completedAt = now;
    endingId = path.end.kind === "ending" ? path.end.id : undefined;
  }

  const startedAt = existing?.startedAt ?? (body.startedAt && !Number.isNaN(Date.parse(body.startedAt)) ? body.startedAt : now);
  const response: ResponseRecord = {
    id: existing?.id ?? uid(14),
    formId: form.id,
    answers,
    hidden,
    score: computeScore(form, answers),
    startedAt,
    updatedAt: now,
    completedAt,
    lastRef: typeof body.lastRef === "string" && fieldByRef(form, body.lastRef) ? body.lastRef : existing?.lastRef,
    endingId,
    meta: {
      userAgent: existing?.meta.userAgent ?? meta.userAgent?.slice(0, 300),
      referrer: existing?.meta.referrer ?? meta.referrer?.slice(0, 500),
      durationMs: completedAt ? Date.parse(completedAt) - Date.parse(startedAt) : undefined,
    },
  };

  let resumeToken: string | undefined;
  let resumeHash: string;
  if (existing) {
    resumeHash = (await getResponse(existing.id))!.resumeHash;
  } else {
    resumeToken = crypto.randomBytes(24).toString("base64url");
    resumeHash = hash(resumeToken);
  }
  await saveResponse(response, resumeHash);
  if (!existing) await meter(ownerId, "responses_started");
  if (completedAt) await meter(ownerId, "responses_completed");

  if (completedAt) await deliverWebhook(form, response);
  return { ok: true, data: { responseId: response.id, resumeToken, endingId, score: response.score } };
}

export async function resume(form: Form, id: string, token: string): Promise<ResponseRecord | null> {
  const found = await getResponse(id);
  if (!found || found.response.formId !== form.id || hash(token) !== found.resumeHash) return null;
  return found.response;
}

export function webhookPayload(form: Form, response: ResponseRecord) {
  return {
    event: "response.completed",
    form: { id: form.id, slug: form.slug, title: form.title },
    response: {
      id: response.id,
      startedAt: response.startedAt,
      completedAt: response.completedAt,
      score: response.score,
      ending: form.endings.find((e) => e.id === response.endingId)?.title ?? null,
      hidden: response.hidden,
      answers: form.fields
        .filter((f) => isQuestion(f) && response.answers[f.ref] !== undefined)
        .map((f) => ({ ref: f.ref, type: f.type, question: f.title, value: response.answers[f.ref] })),
    },
  };
}

export async function deliverWebhook(form: Form, response: ResponseRecord): Promise<{ ok: boolean; status?: number; error?: string }> {
  const url = form.settings.webhookUrl;
  if (!url) return { ok: true };
  const blocked = await webhookBlocked(url);
  if (blocked) {
    console.warn(`[clayform] webhook to ${url} refused: ${blocked}`);
    return { ok: false, error: blocked };
  }
  const body = JSON.stringify(webhookPayload(form, response));
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "Clayform-Webhook/1" };
  if (form.settings.webhookSecret)
    headers["x-clayform-signature"] =
      "sha256=" + crypto.createHmac("sha256", form.settings.webhookSecret).update(body).digest("hex");
  try {
    // No redirects: a public URL could otherwise bounce the request to a private one.
    const res = await fetch(url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(5000) });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    console.warn(`[clayform] webhook to ${url} failed:`, (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}
