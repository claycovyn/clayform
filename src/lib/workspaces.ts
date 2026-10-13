// The admin's view of every workspace: usage this month, estimated cost to serve, revenue and margin.
import "server-only";
import { adminUsers, usageRows } from "./db";
import { estimateCost, getUnitCosts, type UnitCosts } from "./costs";
import { entitlementLimits, usageStatus } from "./mcp-kit";
import { CLOUD, emptyUsage, getPacks, monthOf, planOf, PLANS, type Metric, type PlanId, type Usage } from "./plans";

export interface WorkspaceRow {
  id: string;
  email: string;
  name: string;
  plan: PlanId;
  createdAt: string;
  forms: number;
  storageBytes: number;
  usage: Usage;
  costUsd: number;
  /**
   * Plan price while billing is manual. An OpenCtrl Cloud subscription ($12) covers every Original, so this is the
   * whole subscription until OpenCtrl allocates revenue across apps (build plan 7.3 / 7.8).
   */
  revenueUsd: number;
  marginUsd: number;
  overLimit: boolean;
  packs: Record<string, number>;
  emailVerified: boolean;
}

export async function workspaceReport(month = new Date()): Promise<{ rows: WorkspaceRow[]; units: UnitCosts; label: string; totals: Omit<WorkspaceRow, "id" | "email" | "name" | "plan" | "createdAt" | "overLimit" | "packs" | "emailVerified"> }> {
  const { from, to, label } = monthOf(month);
  const [users, usage, units] = await Promise.all([adminUsers(), usageRows(from, to), getUnitCosts()]);
  const packs = new Map(await Promise.all(users.map(async (u) => [u.id, await getPacks(u.id)] as const)));
  const byUser = new Map<string, Usage>();
  for (const r of usage) {
    const u = byUser.get(r.userId) ?? emptyUsage();
    if (r.metric in u) u[r.metric as Metric] += r.amount;
    byUser.set(r.userId, u);
  }
  const rows = users.map((u): WorkspaceRow => {
    const plan = planOf(u);
    const use = byUser.get(u.id) ?? emptyUsage();
    const costUsd = estimateCost(use, u.storageBytes, units, users.length);
    const revenueUsd = PLANS[plan].priceCents / 100;
    const limits = entitlementLimits(CLOUD, PLANS[plan].tier, packs.get(u.id) ?? {});
    const status = usageStatus(CLOUD, limits, { responses: use.responses_completed, storage: u.storageBytes / 1024 ** 3, emails: 0 });
    return { ...u, plan, usage: use, costUsd, revenueUsd, marginUsd: Math.round((revenueUsd - costUsd) * 10000) / 10000, overLimit: status.some((m) => m.state === "over"), packs: packs.get(u.id) ?? {} };
  });
  rows.sort((a, b) => a.marginUsd - b.marginUsd || b.usage.responses_started - a.usage.responses_started);
  const totals = rows.reduce(
    (t, r) => {
      t.forms += r.forms;
      t.storageBytes += r.storageBytes;
      for (const k of Object.keys(t.usage) as Metric[]) t.usage[k] += r.usage[k];
      t.costUsd += r.costUsd;
      t.revenueUsd += r.revenueUsd;
      t.marginUsd += r.marginUsd;
      return t;
    },
    { forms: 0, storageBytes: 0, usage: emptyUsage(), costUsd: 0, revenueUsd: 0, marginUsd: 0 },
  );
  return { rows, units, label, totals };
}
