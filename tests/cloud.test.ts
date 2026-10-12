// Build plan 7.1: metering, Free Cloud limits, cost to serve and abuse prevention, on a throwaway SQLite database.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "clayform-cloud-"));
process.env.CLAYFORM_DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
if (process.env.CLAYFORM_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.CLAYFORM_TEST_DATABASE_URL;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const ORIGIN = "http://clayform.test";
let db: typeof import("@/lib/db");
let plans: typeof import("@/lib/plans");
let submitMod: typeof import("@/lib/submit");
let formOps: typeof import("@/lib/formOps");
let keys: typeof import("@/lib/apiKeys");

let n = 0;
async function user(plan: string) {
  const now = new Date().toISOString();
  const id = `u${++n}_${Date.now().toString(36)}`;
  await db.createUser({ id, email: `${id}@example.com`, name: id, passwordHash: "x", passwordChangedAt: now, createdAt: now, plan });
  return (await db.getUser(id))!;
}
async function publishedForm(ownerId: string, fields = [{ type: "short_text" as const, title: "Your name?", ref: "name" }]) {
  const f = formOps.createForm("Test", fields);
  f.status = "published";
  await db.saveForm(f, ownerId);
  return f;
}
const answer = (form: { id: string }, extra: Record<string, unknown> = {}) => submitMod.submit(form as never, { answers: { name: "Ada" }, complete: true, ...extra }, {});

beforeAll(async () => {
  db = await import("@/lib/db");
  plans = await import("@/lib/plans");
  submitMod = await import("@/lib/submit");
  formOps = await import("@/lib/formOps");
  keys = await import("@/lib/apiKeys");
});
afterEach(() => {
  delete process.env.CLAYFORM_CLOUD;
});
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe("plans", () => {
  it("new sign-ups get Free Cloud only once Cloud is on; older accounts are grandfathered", async () => {
    expect(plans.newUserPlan()).toBe("grandfathered");
    process.env.CLAYFORM_CLOUD = "1";
    expect(plans.newUserPlan()).toBe("free");
    expect(plans.planOf({ plan: undefined })).toBe("grandfathered");
    expect(plans.PLANS.free.limits.responsesPerMonth).toBe(100);
    expect(plans.PLANS.pro.priceCents).toBe(900);
  });

  it("months are UTC calendar months", () => {
    const m = plans.monthOf(new Date("2026-02-14T23:30:00Z"));
    expect(m).toMatchObject({ from: "2026-02-01", to: "2026-02-28", label: "2026-02", resetsAt: "2026-03-01T00:00:00.000Z" });
  });
});

describe("metering and the Free Cloud limit", () => {
  it("counts started and completed responses per workspace", async () => {
    const u = await user("free");
    const form = await publishedForm(u.id);
    await answer(form);
    await submitMod.submit(form as never, { answers: { name: "Grace" } }, {}); // started, not finished
    const usage = await plans.monthUsage(u.id);
    expect(usage).toMatchObject({ responses_started: 2, responses_completed: 1 });
  });

  it("pauses new responses at 100 a month on Free Cloud, without losing data or stopping people mid-form", async () => {
    process.env.CLAYFORM_CLOUD = "1";
    const u = await user("free");
    const form = await publishedForm(u.id);
    const inProgress = await submitMod.submit(form as never, { answers: { name: "Early" } }, {});
    expect(inProgress.ok).toBe(true);
    await db.addUsage(u.id, "responses_completed", 99, plans.utcDay());
    expect((await answer(form)).ok).toBe(true); // the 100th
    const status = await plans.limitStatus(u);
    expect(status).toMatchObject({ paused: true, responses: { used: 100, limit: 100 } });

    const blocked = await answer(form);
    expect(blocked).toMatchObject({ ok: false, status: 403, error: plans.PAUSED_MESSAGE });
    // Someone who started before the limit can still finish.
    if (!inProgress.ok) throw new Error();
    const finish = await submitMod.submit(form as never, { responseId: inProgress.data.responseId, resumeToken: inProgress.data.resumeToken, answers: {}, complete: true }, {});
    expect(finish.ok).toBe(true);
    // Nothing deleted; export still works.
    expect((await db.listResponses(form.id)).length).toBe(2);
    const exp = await import("@/app/api/forms/[id]/export/route");
    const { secret } = await keys.issueApiKey(u.id, "export", ["responses:read"]);
    const res = await exp.GET(new Request(`${ORIGIN}/api/forms/${form.id}/export?format=json`, { headers: { authorization: `Bearer ${secret}` } }), { params: Promise.resolve({ id: form.id }) });
    expect(res.status).toBe(200);
    expect((await res.json()).responses).toHaveLength(2);
  });

  it("never limits grandfathered or Pro workspaces, or anyone when Cloud is off", async () => {
    for (const plan of ["grandfathered", "pro"]) {
      process.env.CLAYFORM_CLOUD = "1";
      const u = await user(plan);
      const form = await publishedForm(u.id);
      await db.addUsage(u.id, "responses_completed", 5000, plans.utcDay());
      expect((await answer(form)).ok, plan).toBe(true);
    }
    delete process.env.CLAYFORM_CLOUD;
    const u = await user("free");
    const form = await publishedForm(u.id);
    await db.addUsage(u.id, "responses_completed", 5000, plans.utcDay());
    expect((await answer(form)).ok).toBe(true);
  });

  it("meters uploads and API requests", async () => {
    const u = await user("free");
    const form = await publishedForm(u.id, [{ type: "file_upload", title: "A file?", ref: "file" } as never]);
    const upload = await import("@/app/api/f/[slug]/upload/route");
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array(1234)], "a.bin"));
    const res = await upload.POST(new Request(`${ORIGIN}/api/f/${form.slug}/upload`, { method: "POST", body: fd, headers: { "x-forwarded-for": "10.0.0.9" } }), { params: Promise.resolve({ slug: form.slug }) });
    expect(res.status).toBe(200);
    const { secret } = await keys.issueApiKey(u.id, "k", ["forms:read"]);
    const forms = await import("@/app/api/forms/route");
    await forms.GET(new Request(`${ORIGIN}/api/forms`, { headers: { authorization: `Bearer ${secret}` } }));
    expect(await plans.monthUsage(u.id)).toMatchObject({ uploads_bytes: 1234, api_requests: 1 });
  });
});

describe("cost to serve", () => {
  it("estimates from admin-entered unit costs, starting at $0", async () => {
    const { estimateCost, getUnitCosts, saveUnitCosts, ZERO_COSTS } = await import("@/lib/costs");
    await db.setSetting("unit_costs", ""); // a reused test database may hold an earlier run's costs
    expect(await getUnitCosts()).toEqual(ZERO_COSTS);
    const usage = { ...plans.emptyUsage(), responses_started: 2000, api_requests: 1000, support_tickets: 1, uploads_bytes: 1024 ** 3 };
    const units = { ...ZERO_COSTS, per1000Responses: 0.01, per1000ApiRequests: 0.002, perSupportTicket: 3, uploadGb: 0.05, storageGbMonth: 0.25, fixedMonthly: 20 };
    expect(estimateCost(usage, 2 * 1024 ** 3, units, 10)).toBeCloseTo(0.02 + 0.002 + 3 + 0.05 + 0.5 + 2, 4);
    await saveUnitCosts(units);
    expect((await getUnitCosts()).perSupportTicket).toBe(3);
    const { workspaceReport } = await import("@/lib/workspaces");
    const report = await workspaceReport();
    expect(report.rows.length).toBeGreaterThan(0);
    const pro = report.rows.find((r) => r.plan === "pro")!;
    expect(pro.revenueUsd).toBe(9);
    expect(report.rows[0].marginUsd).toBeLessThanOrEqual(report.rows[report.rows.length - 1].marginUsd);
  });
});

describe("abuse prevention", () => {
  it("recognises credential harvesting and impersonation", async () => {
    const { credentialProblems, impersonationSignals, publishRefusal } = await import("@/lib/abuse");
    const pw = formOps.createForm("Account check", [{ type: "short_text", title: "Enter your password", ref: "pw" }]);
    expect(credentialProblems(pw)).toEqual(["asks for a password"]);
    expect(publishRefusal(pw)).toMatch(/collect credentials/);
    expect(credentialProblems(formOps.createForm("Wallet", [{ type: "long_text", title: "Paste your seed phrase", ref: "s" }]))).toHaveLength(1);
    expect(credentialProblems(formOps.createForm("Feedback", [{ type: "short_text", title: "How did you hear about us?", ref: "h" }]))).toEqual([]);
    expect(impersonationSignals(formOps.createForm("PayPal: verify your account"))).toHaveLength(1);
    expect(impersonationSignals(formOps.createForm("PayPal checkout feedback survey"))).toEqual([]);
  });

  it("refuses to publish credential forms on the Cloud (REST and MCP), allows them self-hosted", async () => {
    const u = await user("free");
    const draft = formOps.createForm("Login", [{ type: "short_text", title: "Your password?", ref: "pw" }]);
    await db.saveForm(draft, u.id);
    const { secret } = await keys.issueApiKey(u.id, "w", ["forms:read", "forms:write"]);
    const route = await import("@/app/api/forms/[id]/route");
    const put = () => route.PUT(new Request(`${ORIGIN}/api/forms/${draft.id}`, { method: "PUT", headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify({ ...draft, status: "published" }) }), { params: Promise.resolve({ id: draft.id }) });
    process.env.CLAYFORM_CLOUD = "1";
    expect((await put()).status).toBe(422);
    const { handleMcp } = await import("@/lib/mcp/handler");
    const call = await handleMcp(new Request(`${ORIGIN}/api/mcp`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "publish_form", arguments: { form_id: draft.id } } }) }));
    const body = await call.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/collect credentials/);
    delete process.env.CLAYFORM_CLOUD;
    expect((await put()).status).toBe(200);
  });

  it("takes reported forms down and keeps them down", async () => {
    const u = await user("free");
    const form = await publishedForm(u.id);
    const report = await import("@/app/api/f/[slug]/report/route");
    const post = (body: unknown, ip = "10.1.1.1") => report.POST(new Request(`${ORIGIN}/api/f/${form.slug}/report`, { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify(body) }), { params: Promise.resolve({ slug: form.slug }) });
    expect((await post({ reason: "nonsense" })).status).toBe(422);
    expect((await post({ reason: "phishing", details: "asks for my bank login" })).status).toBe(201);
    const open = await db.listReports(true);
    expect(open.find((r) => r.formId === form.id)?.details).toBe("asks for my bank login");

    await db.setTakedown(form.id, "Phishing");
    expect(await answer(form)).toMatchObject({ ok: false, status: 403, error: submitMod.TAKEN_DOWN_MESSAGE });
    // The owner republishing doesn't bring it back.
    await db.saveForm({ ...form, status: "published", updatedAt: new Date().toISOString() }, u.id);
    expect(await submitMod.closedReason((await db.getForm(form.id))!)).toBe(submitMod.TAKEN_DOWN_MESSAGE);
    await db.setTakedown(form.id, null);
    expect((await answer(form)).ok).toBe(true);
  });

  it("admins come from CLAYFORM_ADMIN_EMAILS; the admin route hides itself from everyone else", async () => {
    const { isAdmin } = await import("@/lib/admin");
    process.env.CLAYFORM_ADMIN_EMAILS = "Boss@Example.com, other@example.com";
    expect(isAdmin({ email: "boss@example.com" })).toBe(true);
    expect(isAdmin({ email: "nobody@example.com" })).toBe(false);
    const route = await import("@/app/api/admin/route");
    const res = await route.POST(new Request(`${ORIGIN}/api/admin`, { method: "POST", body: new URLSearchParams({ action: "plan", userId: "x", plan: "pro" }) }));
    expect(res.status).toBe(404);
    delete process.env.CLAYFORM_ADMIN_EMAILS;
  });
});
