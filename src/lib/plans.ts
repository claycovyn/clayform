// OPENCTRL Cloud plans, metering and limits. The software is free; limits only exist on the hosted Cloud
// (CLAYFORM_CLOUD=1). Self-hosted installs meter usage for their own stats but never enforce limits.
import "server-only";
import { addUsage, getUser, usageRows, type User } from "./db";

export const cloudEnabled = () => process.env.CLAYFORM_CLOUD === "1";

export type PlanId = "free" | "pro" | "grandfathered";

export interface PlanLimits {
  /** Completed responses per calendar month (UTC), across the workspace. null = no limit. */
  responsesPerMonth: number | null;
  /** Set from metering data before Free Cloud launches (build plan 7.2). null = not enforced yet. */
  storageMb: number | null;
  uploadsMbPerMonth: number | null;
}

export const PLANS: Record<PlanId, { name: string; priceCents: number; limits: PlanLimits }> = {
  free: { name: "Free Cloud", priceCents: 0, limits: { responsesPerMonth: 100, storageMb: null, uploadsMbPerMonth: null } },
  pro: { name: "Pro Cloud", priceCents: 900, limits: { responsesPerMonth: null, storageMb: null, uploadsMbPerMonth: null } },
  // Accounts from before Free Cloud keep what they signed up for: no response caps (build plan decision 3).
  grandfathered: { name: "Early account", priceCents: 0, limits: { responsesPerMonth: null, storageMb: null, uploadsMbPerMonth: null } },
};

export function planOf(user: Pick<User, "plan">): PlanId {
  return user.plan === "free" || user.plan === "pro" ? user.plan : "grandfathered";
}

/** New sign-ups get Free Cloud once Cloud is on; before that they keep today's promise. */
export function newUserPlan(): PlanId {
  return cloudEnabled() ? "free" : "grandfathered";
}

export const METRICS = ["responses_started", "responses_completed", "uploads_bytes", "api_requests", "emails_sent", "support_tickets"] as const;
export type Metric = (typeof METRICS)[number];
export type Usage = Record<Metric, number>;

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

export function monthOf(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const next = new Date(Date.UTC(y, m + 1, 1));
  return { from: utcDay(start), to: utcDay(new Date(next.getTime() - 86_400_000)), resetsAt: next.toISOString(), label: start.toISOString().slice(0, 7) };
}

/** Records usage. Metering must never break the request it measures, so failures are only logged. */
export async function meter(userId: string | null | undefined, metric: Metric, amount = 1): Promise<void> {
  if (!userId || amount <= 0) return;
  try {
    await addUsage(userId, metric, Math.round(amount), utcDay());
  } catch (e) {
    console.error(`[metering] ${metric} for ${userId} failed`, e);
  }
}

export function emptyUsage(): Usage {
  return Object.fromEntries(METRICS.map((m) => [m, 0])) as Usage;
}

export async function monthUsage(userId: string, d = new Date()): Promise<Usage> {
  const { from, to } = monthOf(d);
  const out = emptyUsage();
  for (const r of await usageRows(from, to, userId)) if (r.metric in out) out[r.metric as Metric] += r.amount;
  return out;
}

export interface LimitStatus {
  plan: PlanId;
  planName: string;
  enforced: boolean;
  responses: { used: number; limit: number | null };
  paused: boolean;
  resetsAt: string;
}

export async function limitStatus(user: Pick<User, "id" | "plan">, d = new Date()): Promise<LimitStatus> {
  const plan = planOf(user);
  const usage = await monthUsage(user.id, d);
  const limit = PLANS[plan].limits.responsesPerMonth;
  const enforced = cloudEnabled();
  return {
    plan,
    planName: PLANS[plan].name,
    enforced,
    responses: { used: usage.responses_completed, limit },
    paused: enforced && limit !== null && usage.responses_completed >= limit,
    resetsAt: monthOf(d).resetsAt,
  };
}

/** Whether a workspace's forms should turn away *new* respondents (people already answering can finish). */
export async function newResponsesPaused(ownerId: string | null): Promise<boolean> {
  if (!cloudEnabled() || !ownerId) return false;
  const user = await getUser(ownerId);
  return user ? (await limitStatus(user)).paused : false;
}

export const PAUSED_MESSAGE = "This form isn't taking new responses right now. Please check back later.";
