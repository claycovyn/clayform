// The admin's view of every workspace: usage this month, estimated cost to serve, revenue and margin.
import "server-only";
import { adminUsers, usageRows } from "./db";
import { estimateCost, getUnitCosts, type UnitCosts } from "./costs";
import { emptyUsage, monthOf, planOf, PLANS, type Metric, type PlanId, type Usage } from "./plans";

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
  /** Plan price while billing is manual (build plan 7.3 replaces this with Stripe revenue). */
  revenueUsd: number;
  marginUsd: number;
  overLimit: boolean;
}

export async function workspaceReport(month = new Date()): Promise<{ rows: WorkspaceRow[]; units: UnitCosts; label: string; totals: Omit<WorkspaceRow, "id" | "email" | "name" | "plan" | "createdAt" | "overLimit"> }> {
  const { from, to, label } = monthOf(month);
  const [users, usage, units] = await Promise.all([adminUsers(), usageRows(from, to), getUnitCosts()]);
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
    const limit = PLANS[plan].limits.responsesPerMonth;
    return { ...u, plan, usage: use, costUsd, revenueUsd, marginUsd: Math.round((revenueUsd - costUsd) * 10000) / 10000, overLimit: limit !== null && use.responses_completed >= limit };
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
