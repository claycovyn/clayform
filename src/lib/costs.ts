// Cost to serve, per workspace. Unit costs are entered by an admin from the real provider bills (Vercel, the Postgres
// host, storage, email) and stored in settings; they start at 0 so nothing is invented.
import "server-only";
import { getSetting, setSetting } from "./db";
import type { Usage } from "./plans";

export interface UnitCosts {
  /** USD per GB-month of stored data (forms, responses, files). */
  storageGbMonth: number;
  /** USD per GB-month of backups (applied to stored GB). */
  backupGbMonth: number;
  /** USD per GB uploaded (transfer in). */
  uploadGb: number;
  /** USD per 1,000 responses started (compute + writes). */
  per1000Responses: number;
  per1000ApiRequests: number;
  per1000Emails: number;
  perSupportTicket: number;
  /** Fixed platform cost per month (plans, domains…), shared evenly across workspaces. */
  fixedMonthly: number;
}

export const UNIT_COST_LABELS: Record<keyof UnitCosts, string> = {
  storageGbMonth: "Storage, per GB-month",
  backupGbMonth: "Backups, per GB-month",
  uploadGb: "Uploads, per GB",
  per1000Responses: "Per 1,000 responses",
  per1000ApiRequests: "Per 1,000 API/MCP requests",
  per1000Emails: "Per 1,000 emails",
  perSupportTicket: "Per support ticket",
  fixedMonthly: "Fixed monthly (shared)",
};

export const ZERO_COSTS: UnitCosts = { storageGbMonth: 0, backupGbMonth: 0, uploadGb: 0, per1000Responses: 0, per1000ApiRequests: 0, per1000Emails: 0, perSupportTicket: 0, fixedMonthly: 0 };

export async function getUnitCosts(): Promise<UnitCosts> {
  const raw = await getSetting("unit_costs");
  if (!raw) return { ...ZERO_COSTS };
  try {
    const v = JSON.parse(raw);
    return Object.fromEntries(Object.keys(ZERO_COSTS).map((k) => [k, Number.isFinite(Number(v[k])) && Number(v[k]) >= 0 ? Number(v[k]) : 0])) as unknown as UnitCosts;
  } catch {
    return { ...ZERO_COSTS };
  }
}

export async function saveUnitCosts(c: UnitCosts): Promise<void> {
  await setSetting("unit_costs", JSON.stringify(c));
}

const GB = 1024 ** 3;

/** Estimated monthly cost for one workspace (USD). */
export function estimateCost(usage: Usage, storageBytes: number, units: UnitCosts, workspaces: number): number {
  const gb = storageBytes / GB;
  const cost =
    gb * (units.storageGbMonth + units.backupGbMonth) +
    (usage.uploads_bytes / GB) * units.uploadGb +
    (usage.responses_started / 1000) * units.per1000Responses +
    (usage.api_requests / 1000) * units.per1000ApiRequests +
    (usage.emails_sent / 1000) * units.per1000Emails +
    usage.support_tickets * units.perSupportTicket +
    (workspaces > 0 ? units.fixedMonthly / workspaces : 0);
  return Math.round(cost * 10000) / 10000;
}
