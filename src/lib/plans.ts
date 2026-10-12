// OPENCTRL Cloud for Clayform: tiers, metering, limits and usage notices. The software is free; limits only exist on the
// hosted Cloud (CLAYFORM_CLOUD=1). Self-hosted installs meter usage for their own stats but are never limited.
//
// Limits come from this app's openctrl.json `cloud` section (Free tier, fair use, packs), via the OPENCTRL kit:
// - Free tier: the entry point. At a limit, new activity pauses (never deletes); the prompt is to join OPENCTRL Cloud.
// - OPENCTRL Cloud ($12/month, every Original): fair-use limits plus packs. Never paused for going over; prompted to
//   add a pack instead.
// - Grandfathered: accounts from before Cloud was switched on. No limits.
import "server-only";
import manifestJson from "../../openctrl.json";
import { addUsage, getSetting, getUser, setSetting, storageBytes, usageRows, type User } from "./db";
import { sendEmail } from "./email";
import { cloudSchema, entitlementLimits, packsFor, usageStatus, type CloudSpec, type Limits, type MeterStatus, type Tier } from "./mcp-kit";
import { siteUrl } from "./site";

export const cloudEnabled = () => process.env.CLAYFORM_CLOUD === "1";

/** Clayform's own Cloud spec, validated once at startup (a broken manifest fails loudly in tests and builds). */
export const CLOUD: CloudSpec = cloudSchema.parse(manifestJson.cloud);

export type PlanId = "free" | "cloud" | "grandfathered";
export const PLANS: Record<PlanId, { name: string; priceCents: number; tier: Tier }> = {
  free: { name: "Free Cloud", priceCents: 0, tier: "free" },
  cloud: { name: "OPENCTRL Cloud", priceCents: 1200, tier: "cloud" },
  grandfathered: { name: "Early account", priceCents: 0, tier: "unlimited" },
};
export const CLOUD_PRICE_LABEL = "$12/month";

export function planOf(user: Pick<User, "plan">): PlanId {
  if (user.plan === "free") return "free";
  if (user.plan === "cloud" || user.plan === "pro") return "cloud";
  return "grandfathered";
}

/** New sign-ups get the Free tier once Cloud is on; before that they keep today's promise (no caps). */
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

/** Add-on packs bought for a workspace ({ packId: quantity }). Set by an admin until OPENCTRL billing (build plan 7.3). */
export async function getPacks(userId: string): Promise<Record<string, number>> {
  try {
    const v = JSON.parse((await getSetting(`packs:${userId}`)) ?? "{}");
    return Object.fromEntries(CLOUD.packs.map((p) => [p.id, Math.max(0, Math.floor(Number(v[p.id]) || 0))]).filter(([, n]) => (n as number) > 0));
  } catch {
    return {};
  }
}
export async function setPacks(userId: string, packs: Record<string, number>): Promise<void> {
  await setSetting(`packs:${userId}`, JSON.stringify(packs));
}

const GB = 1024 ** 3;

/** The manifest's meters, measured for one workspace. */
export async function meterValues(userId: string, d = new Date()): Promise<Record<string, number>> {
  const usage = await monthUsage(userId, d);
  return {
    responses: usage.responses_completed,
    storage: Math.round(((await storageBytes(userId)) / GB) * 1000) / 1000,
    // The "emails" meter counts emails a workspace's forms send for it. Clayform has no such feature yet; its own
    // account and usage emails are counted in emails_sent for cost to serve, never against the workspace's limit.
    emails: 0,
  };
}

export interface LimitStatus {
  plan: PlanId;
  planName: string;
  tier: Tier;
  enforced: boolean;
  limits: Limits;
  meters: MeterStatus[];
  /** Free tier only: new respondents are turned away. */
  responsesPaused: boolean;
  /** Free tier only: new file uploads are refused. */
  uploadsPaused: boolean;
  resetsAt: string;
  packs: Record<string, number>;
}

export async function limitStatus(user: Pick<User, "id" | "plan">, d = new Date()): Promise<LimitStatus> {
  const plan = planOf(user);
  const enforced = cloudEnabled();
  const tier: Tier = enforced ? PLANS[plan].tier : "unlimited";
  const packs = await getPacks(user.id);
  const limits = entitlementLimits(CLOUD, tier, packs);
  const meters = usageStatus(CLOUD, limits, await meterValues(user.id, d));
  const over = (m: string) => meters.find((x) => x.meter === m)?.state === "over";
  return {
    plan,
    planName: PLANS[plan].name,
    tier,
    enforced,
    limits,
    meters,
    responsesPaused: tier === "free" && over("responses"),
    uploadsPaused: tier === "free" && over("storage"),
    resetsAt: monthOf(d).resetsAt,
    packs,
  };
}

/** Whether a workspace's forms should turn away *new* respondents (people already answering can finish). */
export async function newResponsesPaused(ownerId: string | null): Promise<boolean> {
  if (!cloudEnabled() || !ownerId) return false;
  const user = await getUser(ownerId);
  return user ? (await limitStatus(user)).responsesPaused : false;
}

export async function uploadsPaused(ownerId: string | null): Promise<boolean> {
  if (!cloudEnabled() || !ownerId) return false;
  const user = await getUser(ownerId);
  return user ? (await limitStatus(user)).uploadsPaused : false;
}

export const PAUSED_MESSAGE = "This form isn't taking new responses right now. Please check back later.";
export const UPLOADS_PAUSED_MESSAGE = "This form can't take more files right now. You can still send your answers without one.";

/** What to say when a meter is at 80% or 100%: an upgrade for Free, a pack for OPENCTRL Cloud. Never "we deleted". */
export function noticeFor(status: LimitStatus, m: MeterStatus, threshold: 80 | 100): { subject: string; body: string } {
  const what = `${m.used.toLocaleString("en-US")} of ${m.limit?.toLocaleString("en-US")} ${m.unit}${m.period === "month" ? " this month" : ""}`;
  const offer =
    status.tier === "free"
      ? `Join OPENCTRL Cloud for ${CLOUD_PRICE_LABEL} to raise this to ${CLOUD.fair_use[m.meter]?.toLocaleString("en-US")} ${m.unit}, and get every other OPENCTRL app too.`
      : packsFor(CLOUD, m.meter).length
        ? `Add a pack (${packsFor(CLOUD, m.meter).map((p) => p.label).join(", ")}) to raise it. Your forms keep working either way.`
        : "Your forms keep working. We'll be in touch if this keeps up.";
  const paused =
    status.tier === "free" && threshold === 100
      ? m.meter === "responses"
        ? "Your forms have stopped taking new responses until the limit resets. People already answering can finish."
        : m.meter === "storage"
          ? "Your forms have stopped taking new file uploads."
          : ""
      : "";
  return {
    subject: threshold === 100 ? `Clayform: you've reached your ${m.meter} limit` : `Clayform: you've used 80% of your ${m.meter}`,
    body: [`You've used ${what} on ${status.planName}.`, paused, offer, "Nothing has been deleted, and you can export everything at any time.", `Your usage: ${siteUrl()}/forms`]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/** Sends each 80% / 100% notice once per meter per month. Called after usage grows; never throws. */
export async function checkUsageNotices(ownerId: string | null): Promise<void> {
  if (!cloudEnabled() || !ownerId) return;
  try {
    const user = await getUser(ownerId);
    if (!user) return;
    const status = await limitStatus(user);
    if (status.tier === "unlimited") return;
    const month = monthOf().label;
    for (const m of status.meters) {
      if (m.limit === null || m.pct === null) continue;
      for (const t of [100, 80] as const) {
        if (m.pct < t) continue;
        const key = `notice:${user.id}:${month}:${m.meter}:${t}`;
        if (await getSetting(key)) break; // already told (100 implies 80 was sent or skipped)
        await setSetting(key, new Date().toISOString());
        if (t === 100) await setSetting(`notice:${user.id}:${month}:${m.meter}:80`, new Date().toISOString());
        const n = noticeFor(status, m, t);
        const r = await sendEmail(user.email, n.subject, n.body);
        if (r.sent) await meter(user.id, "emails_sent");
        break;
      }
    }
  } catch (e) {
    console.error("[usage notices] failed", e);
  }
}
