// End to end through the real HTTP handlers, on a throwaway SQLite database (or Postgres when
// CLAYFORM_TEST_DATABASE_URL points at an empty test database):
// API keys → the MCP endpoint → an agent builds, publishes and reads a form. Plus the REST API with keys.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "clayform-mcp-"));
process.env.CLAYFORM_DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
if (process.env.CLAYFORM_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.CLAYFORM_TEST_DATABASE_URL;
delete process.env.NEXT_PUBLIC_SITE_URL;

// No browser session in these tests: the cookie jar is always empty.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const ORIGIN = "http://clayform.test";
type Text = { content: { type: string; text: string }[]; isError?: boolean };

let db: typeof import("@/lib/db");
let keys: typeof import("@/lib/apiKeys");
let handleMcp: typeof import("@/lib/mcp/handler").handleMcp;
let submit: typeof import("@/lib/submit").submit;
let userId = "";
let otherUserId = "";

const RUN = Date.now().toString(36);
async function makeUser(email: string) {
  email = email.replace("@", `+${RUN}@`);
  const id = `u_${email.split("@")[0]}`;
  const now = new Date().toISOString();
  await db.createUser({ id, email, name: email, passwordHash: "x", passwordChangedAt: now, createdAt: now });
  return id;
}

async function connect(secret: string) {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/api/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
    fetch: (url, init) => handleMcp(new Request(url, init)),
  });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as Text;
  const text = r.content[0]?.text ?? "";
  return { error: r.isError ? text : null, data: r.isError ? null : JSON.parse(text) };
}

const rpc = (headers: Record<string, string>, body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/list" }) =>
  handleMcp(new Request(`${ORIGIN}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) }));

beforeAll(async () => {
  db = await import("@/lib/db");
  keys = await import("@/lib/apiKeys");
  handleMcp = (await import("@/lib/mcp/handler")).handleMcp;
  submit = (await import("@/lib/submit")).submit;
  userId = await makeUser("clay@example.com");
  otherUserId = await makeUser("other@example.com");
});
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe("API keys", () => {
  it("are shown once, stored only as a hash, and verify until revoked", async () => {
    const { key, secret } = await keys.issueApiKey(userId, "Grok Bot", keys.DEFAULT_SCOPES);
    expect(secret).toMatch(/^cf_[A-Za-z0-9_-]{43}$/);
    expect(key.prefix).toBe(secret.slice(0, 11));
    const stored = (await db.listApiKeys(userId)).find((k) => k.id === key.id)!;
    expect(stored.hash).toBe(keys.hashKey(secret));
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(keys.publicKey(stored)).not.toHaveProperty("hash");
    expect(stored.scopes).not.toContain("responses:delete");

    const ok = await keys.verifyApiKey(secret);
    expect(ok?.user.id).toBe(userId);
    expect((await db.listApiKeys(userId)).find((k) => k.id === key.id)!.lastUsedAt).not.toBeNull();
    expect(await keys.verifyApiKey(secret.slice(0, -1) + (secret.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(await keys.verifyApiKey("cf_short")).toBeNull();

    expect(await db.revokeApiKey(otherUserId, key.id)).toBe(false); // not theirs
    expect(await db.revokeApiKey(userId, key.id)).toBe(true);
    expect(await db.revokeApiKey(userId, key.id)).toBe(false); // already revoked
    expect(await keys.verifyApiKey(secret)).toBeNull();
  });
});

describe("MCP endpoint", () => {
  it("needs a valid, unrevoked key", async () => {
    expect((await rpc({})).status).toBe(401);
    expect((await rpc({ authorization: "Bearer cf_" + "x".repeat(43) })).status).toBe(401);
    const { key, secret } = await keys.issueApiKey(userId, "temp", ["forms:read"]);
    await db.revokeApiKey(userId, key.id);
    const res = await rpc({ authorization: `Bearer ${secret}` });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
  });

  it("lets an agent build, publish, share and read a form (the definition of done)", async () => {
    const { secret } = await keys.issueApiKey(userId, "Grok Bot", keys.DEFAULT_SCOPES);
    const agent = await connect(secret);
    expect(agent.getServerVersion()?.name).toBe("clayform");
    expect(agent.getInstructions()).toMatch(/create_form/);

    const { tools } = await agent.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const n of ["list_forms", "get_form", "create_form", "update_form", "delete_form", "add_field", "update_field", "remove_field", "reorder_fields", "set_logic", "set_endings", "set_theme", "update_settings", "publish_form", "unpublish_form", "get_share_links", "list_responses", "get_response", "get_stats", "export_responses", "delete_responses", "get_file", "set_webhook", "test_webhook", "list_field_types"])
      expect(byName[n], n).toBeTruthy();
    expect(byName.delete_form.annotations?.destructiveHint).toBe(true);
    expect(byName.delete_responses.annotations?.destructiveHint).toBe(true);
    expect(byName.list_forms.annotations?.readOnlyHint).toBe(true);

    const types = await call(agent, "list_field_types");
    expect(types.data.types).toHaveLength(18);

    const created = await call(agent, "create_form", { title: "Coffee feedback", fields: [{ type: "short_text", title: "Your name?", ref: "name", required: true }] });
    expect(created.error).toBeNull();
    const formId = created.data.form.id as string;

    expect((await call(agent, "add_field", { form_id: formId, type: "nps", title: "Would you recommend our coffee?", ref: "nps", required: true })).error).toBeNull();
    expect((await call(agent, "add_field", { form_id: formId, type: "multiple_choice", title: "Favourite drink?", ref: "drink", choices: ["Flat white", "Espresso"] })).error).toBeNull();
    const bad = await call(agent, "add_field", { form_id: formId, type: "short_text", title: "dup", ref: "name" });
    expect(bad.error).toMatch(/already uses the key/);

    const logic = await call(agent, "set_logic", { form_id: formId, rules: [{ from: "nps", conditions: [{ source: "nps", op: "lte", value: 6 }], go_to: "drink" }] });
    expect(logic.error).toBeNull();
    expect((await call(agent, "set_theme", { form_id: formId, preset: "Volt" })).data.form.id).toBe(formId);

    const published = await call(agent, "publish_form", { form_id: formId });
    expect(published.data).toMatchObject({ published: true, status: "published" });
    expect(published.data.url).toMatch(new RegExp(`^${ORIGIN}/f/[a-z0-9-]+$`));
    const links = await call(agent, "get_share_links", { form_id: formId });
    expect(links.data.embed.inline).toContain("embed.js");

    // Two people answer.
    const form = (await db.getForm(formId))!;
    for (const [name, nps] of [["Ada", 10], ["Grace", 4]] as const) {
      const r = await submit(form, { answers: { name, nps, drink: "Espresso" }, complete: true, startedAt: new Date(Date.now() - 30_000).toISOString() }, {});
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }

    const page1 = await call(agent, "list_responses", { form_id: formId, limit: 1 });
    expect(page1.data.responses).toHaveLength(1);
    expect(page1.data.next_cursor).toBeTruthy();
    const page2 = await call(agent, "list_responses", { form_id: formId, limit: 1, cursor: page1.data.next_cursor });
    expect(page2.data.responses).toHaveLength(1);
    expect(page2.data.responses[0].id).not.toBe(page1.data.responses[0].id);
    expect(page2.data.next_cursor).toBeNull();

    const one = await call(agent, "get_response", { response_id: page1.data.responses[0].id });
    expect(one.data.response.formId).toBe(formId);

    const stats = await call(agent, "get_stats", { form_id: formId });
    expect(stats.data).toMatchObject({ starts: 2, completes: 2, completionRate: 100 });
    expect(stats.data.nps[0]).toMatchObject({ ref: "nps", score: 0, answers: 2 });
    expect(stats.data.dropOff.map((d: { ref: string }) => d.ref)).toEqual(["name", "nps", "drink"]);

    const csv = await call(agent, "export_responses", { form_id: formId, format: "csv" });
    expect(csv.data.count).toBe(2);
    expect(csv.data.data).toContain("Ada");

    // This key can't delete responses (not in the default scopes).
    const denied = await call(agent, "delete_responses", { form_id: formId, ids: [page1.data.responses[0].id] });
    expect(denied.error).toMatch(/responses:delete/);

    // Webhooks to private addresses are refused.
    expect((await call(agent, "set_webhook", { form_id: formId, url: "http://127.0.0.1:5432/" })).error).toMatch(/private/);

    expect((await call(agent, "list_forms")).data.forms.map((f: { id: string }) => f.id)).toContain(formId);
    await agent.close();
  });

  it("only ever sees the key owner's forms, and respects scopes", async () => {
    const theirs = await keys.issueApiKey(otherUserId, "theirs", keys.ALL_SCOPES);
    const other = await connect(theirs.secret);
    const created = await call(other, "create_form", { title: "Private" });
    const formId = created.data.form.id;

    const { secret } = await keys.issueApiKey(userId, "read only", ["forms:read"]);
    const reader = await connect(secret);
    expect((await call(reader, "get_form", { form_id: formId })).error).toMatch(/No form/);
    expect((await call(reader, "list_forms")).data.forms.map((f: { id: string }) => f.id)).not.toContain(formId);
    expect((await call(reader, "create_form", { title: "nope" })).error).toMatch(/forms:write/);

    // The owner with every scope can delete.
    expect((await call(other, "delete_form", { form_id: formId })).data.deleted).toBe(formId);
    expect(await db.getForm(formId)).toBeNull();
    await other.close();
    await reader.close();
  });
});

describe("REST API with keys", () => {
  it("accepts keys with the right scope, and keeps key management browser-only", async () => {
    const forms = await import("@/app/api/forms/route");
    const keyRoutes = await import("@/app/api/account/keys/route");
    const { secret } = await keys.issueApiKey(userId, "reader", ["forms:read"]);
    const auth = { authorization: `Bearer ${secret}` };

    expect((await forms.GET(new Request(`${ORIGIN}/api/forms`, { headers: auth }))).status).toBe(200);
    const post = await forms.POST(new Request(`${ORIGIN}/api/forms`, { method: "POST", headers: auth, body: "{}" }));
    expect(post.status).toBe(403);
    expect((await forms.GET(new Request(`${ORIGIN}/api/forms`))).status).toBe(401);
    expect((await forms.GET(new Request(`${ORIGIN}/api/forms`, { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    // A key can't list or mint keys.
    expect((await keyRoutes.GET()).status).toBe(401);
  });

  it("pages responses with a cursor", async () => {
    const { createForm } = await import("@/lib/formOps");
    const form = createForm("Paging", [{ type: "short_text", title: "Hi?", ref: "hi" }]);
    form.status = "published";
    await db.saveForm(form, userId);
    for (let i = 0; i < 5; i++) await submit(form, { answers: { hi: `n${i}` }, complete: i % 2 === 0 }, {});
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const p = await db.queryResponses(form.id, { limit: 2, cursor });
      seen.push(...p.responses.map((r) => r.id));
      cursor = p.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect((await db.queryResponses(form.id, { limit: 10, completedOnly: true })).responses).toHaveLength(3);
    expect((await db.queryResponses(form.id, { limit: 10, since: new Date(Date.now() + 60_000).toISOString() })).responses).toHaveLength(0);
  });

  it("signs file links that expire", async () => {
    const { signedFileUrl, validFileSignature } = await import("@/lib/fileLinks");
    const now = Date.now();
    const { url } = signedFileUrl(ORIGIN, "file123", 60, now);
    const u = new URL(url);
    expect(validFileSignature("file123", u.searchParams.get("exp"), u.searchParams.get("sig"), now)).toBe(true);
    expect(validFileSignature("file124", u.searchParams.get("exp"), u.searchParams.get("sig"), now)).toBe(false);
    expect(validFileSignature("file123", u.searchParams.get("exp"), u.searchParams.get("sig"), now + 61_000)).toBe(false);
  });
});

describe("openctrl.json", () => {
  it("is a valid manifest that matches the real tools and scopes", async () => {
    const manifest = (await import("../openctrl.json")).default;
    const { parseManifest } = await import("@/lib/mcp-kit");
    const { TOOLS } = await import("@/lib/mcp/server");
    const parsed = parseManifest(manifest);
    expect(parsed.ok, !parsed.ok ? parsed.error : "").toBe(true);
    expect([...manifest.mcp.tools].sort()).toEqual(TOOLS.map((t) => t.name).sort());
    expect(Object.fromEntries(manifest.mcp.scopes.map((s) => [s.name, s.description]))).toEqual(keys.SCOPES);
  });
});
