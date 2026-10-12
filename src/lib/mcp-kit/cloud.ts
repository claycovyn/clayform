// OPENCTRL Cloud entitlements, from an app's openctrl.json `cloud` section. Pure, so every app computes limits the
// same way: Free tier → `free`; OPENCTRL Cloud subscriber → `fair_use` plus packs; unlimited (self-hosted or
// grandfathered) → no limits.
import type { CloudSpec } from "./manifest.js";

export type Tier = "free" | "cloud" | "unlimited";
/** null = no limit for that meter. */
export type Limits = Record<string, number | null>;

export function entitlementLimits(cloud: CloudSpec, tier: Tier, packs: Record<string, number> = {}): Limits {
  const out: Limits = {};
  for (const meter of Object.keys(cloud.meters)) {
    if (tier === "unlimited") out[meter] = null;
    else if (tier === "free") out[meter] = cloud.free[meter] ?? null;
    else {
      let limit = cloud.fair_use[meter] ?? null;
      if (limit !== null)
        for (const p of cloud.packs) {
          const qty = Math.max(0, Math.floor(packs[p.id] ?? 0));
          limit += (p.adds[meter] ?? 0) * qty;
        }
      out[meter] = limit;
    }
  }
  return out;
}

export type MeterState = "ok" | "warn" | "over";
export interface MeterStatus {
  meter: string;
  unit: string;
  period: "month" | "current";
  used: number;
  limit: number | null;
  /** 0–100+, or null without a limit. */
  pct: number | null;
  state: MeterState;
}

/** Usage against limits for every declared meter. "warn" from 80%, "over" from 100%. */
export function usageStatus(cloud: CloudSpec, limits: Limits, used: Record<string, number>): MeterStatus[] {
  return Object.entries(cloud.meters).map(([meter, m]) => {
    const u = used[meter] ?? 0;
    const limit = limits[meter] ?? null;
    const pct = limit === null ? null : limit === 0 ? (u > 0 ? Infinity : 0) : (u / limit) * 100;
    return { meter, unit: m.unit, period: m.period, used: u, limit, pct, state: pct === null ? "ok" : pct >= 100 ? "over" : pct >= 80 ? "warn" : "ok" };
  });
}

/** Notice thresholds (80, 100) crossed by going from `before` to `after` against `limit`. */
export function thresholdsCrossed(before: number, after: number, limit: number | null): (80 | 100)[] {
  if (limit === null || limit <= 0) return [];
  return ([80, 100] as const).filter((t) => (before / limit) * 100 < t && (after / limit) * 100 >= t);
}

/** Packs that raise a meter, for "add a pack" offers. */
export function packsFor(cloud: CloudSpec, meter: string) {
  return cloud.packs.filter((p) => (p.adds[meter] ?? 0) > 0);
}
