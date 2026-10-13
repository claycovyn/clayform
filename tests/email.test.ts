// Branded emails: the shared template, the confirmation email and the usage notices. Each renders HTML and plain text,
// escapes what users typed, and keeps its key link and numbers. Set CLAYFORM_EMAIL_PREVIEW_DIR to also write every
// email to static HTML files for a visual check.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.CLAYFORM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "clayform-email-"));
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const ORIGIN = "https://clayform.test";
let tpl: typeof import("@/lib/emailTemplate");
let plans: typeof import("@/lib/plans");
let verify: typeof import("@/lib/verify");

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
  tpl = await import("@/lib/emailTemplate");
  plans = await import("@/lib/plans");
  verify = await import("@/lib/verify");
});

function status(plan: "free" | "cloud"): import("@/lib/plans").LimitStatus {
  return {
    plan,
    planName: plans.PLANS[plan].name,
    tier: plans.PLANS[plan].tier,
    enforced: true,
    limits: {},
    meters: [],
    responsesPaused: false,
    uploadsPaused: false,
    resetsAt: new Date().toISOString(),
    packs: {},
  } as import("@/lib/plans").LimitStatus;
}

function meter(name: "responses" | "storage", limit: number, used: number): import("@/lib/mcp-kit").MeterStatus {
  const m = plans.CLOUD.meters[name];
  return { meter: name, unit: m.unit, period: m.period, used, limit, pct: (used / limit) * 100, state: used >= limit ? "over" : "warn" };
}

const previews: Record<string, import("@/lib/emailTemplate").EmailMessage> = {};
function preview(name: string, msg: import("@/lib/emailTemplate").EmailMessage) {
  previews[name] = msg;
  const dir = process.env.CLAYFORM_EMAIL_PREVIEW_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  // Point the logo at the local file so the preview renders offline.
  const local = "file:///" + path.resolve("public/icon-512.png").replace(/\\/g, "/");
  fs.writeFileSync(path.join(dir, `${name}.html`), msg.html.replaceAll(`${ORIGIN}/icon-512.png`, local));
  fs.writeFileSync(path.join(dir, `${name}.txt`), msg.text);
}

describe("email template", () => {
  it("renders a table layout with an HTML and a plain-text part", () => {
    const m = tpl.renderEmail({
      subject: "Hello",
      preheader: "Preview",
      heading: "A heading",
      blocks: [
        { type: "paragraph", text: "Body copy." },
        { type: "button", label: "Go", href: `${ORIGIN}/go` },
      ],
      siteUrl: ORIGIN,
    });
    expect(m.subject).toBe("Hello");
    expect(m.html).toMatch(/^<!DOCTYPE html>/);
    expect(m.html).toMatch(/max-width:600px/);
    expect(m.html).toMatch(/role="presentation"/);
    expect(m.html).toMatch(/color-scheme/);
    expect(m.html).toContain(`src="${ORIGIN}/icon-512.png"`);
    expect(m.html).not.toMatch(/\.svg/);
    expect(m.html).toContain("Clayform, an OpenCtrl Original");
    expect(m.html).toContain("https://github.com/claycovyn/clayform");
    expect(m.html).toContain(`href="${ORIGIN}/go"`);
    expect(m.text).toContain("A heading");
    expect(m.text).toContain(`Go: ${ORIGIN}/go`);
    expect(m.text).toContain("Clayform, an OpenCtrl Original");
    expect(m.text).not.toMatch(/<[a-z]/i);
  });

  it("escapes everything that goes into the HTML and refuses odd link schemes", () => {
    const evil = `<script>alert("x")</script> & 'quotes'`;
    const m = tpl.renderEmail({
      subject: evil,
      preheader: evil,
      heading: evil,
      blocks: [
        { type: "paragraph", text: evil },
        { type: "button", label: evil, href: "javascript:alert(1)" },
        { type: "link", label: evil, href: `${ORIGIN}/?a="><b>` },
        { type: "meter", label: evil, value: evil, pct: 250 },
        { type: "fineprint", text: evil },
      ],
      reason: evil,
      siteUrl: ORIGIN,
    });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain('"><b>');
    expect(m.html).not.toContain("javascript:");
    expect(m.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;");
    expect(m.text).toContain(evil); // plain text stays as typed
  });

  it("uses CLAYFORM_SOURCE_URL for the source link when set", () => {
    process.env.CLAYFORM_SOURCE_URL = "https://example.com/fork";
    try {
      const m = tpl.renderEmail({ subject: "s", preheader: "p", heading: "h", blocks: [], siteUrl: ORIGIN });
      expect(m.html).toContain("https://example.com/fork");
      expect(m.text).toContain("Source code: https://example.com/fork");
    } finally {
      delete process.env.CLAYFORM_SOURCE_URL;
    }
  });
});

describe("confirmation email", () => {
  it("has the link as a button and in full, and escapes the name", () => {
    const link = verify.verificationLink({ id: "u1", email: "ada@example.com" }, ORIGIN);
    const m = verify.verificationEmail({ name: "Ada <b>Lovelace</b>" }, link, ORIGIN);
    preview("verification", verify.verificationEmail({ name: "Ada" }, link, ORIGIN));
    expect(m.subject).toBe("Confirm your email for Clayform");
    const href = link.replaceAll("&", "&amp;");
    expect(m.html.split(`href="${href}"`).length - 1).toBe(2); // button + fallback
    expect(m.html).toContain("Ada &lt;b&gt;Lovelace&lt;/b&gt;");
    expect(m.html).not.toContain("<b>Lovelace");
    expect(m.html).toContain("3 days");
    expect(m.text).toContain("Hi Ada <b>Lovelace</b>,");
    expect(m.text).toContain(link);
    expect(m.text).toContain("3 days");
  });
});

describe("usage notices", () => {
  it("free tier while the Cloud plan isn't live: says it's coming soon, offers no price", () => {
    delete process.env.CLAYFORM_CLOUD_PLAN_LIVE;
    const limit = plans.CLOUD.free.responses;
    for (const [used, t] of [[Math.round(limit * 0.8), 80], [limit, 100]] as const) {
      const n = plans.noticeFor(status("free"), meter("responses", limit, used), t);
      for (const part of [n.email.html, n.email.text, n.body]) {
        expect(part).toContain("OpenCtrl Cloud is coming soon: one subscription for every OpenCtrl app with much higher limits.");
        expect(part).not.toContain("$12/month");
        expect(part).not.toContain("Join OpenCtrl Cloud");
        expect(part).toContain("Nothing has been deleted");
      }
    }
  });

  it("free tier at 80%: numbers from the manifest, the upgrade and the usage link", () => {
    process.env.CLAYFORM_CLOUD_PLAN_LIVE = "1";
    const limit = plans.CLOUD.free.responses;
    const used = Math.round(limit * 0.8);
    const n = plans.noticeFor(status("free"), meter("responses", limit, used), 80);
    delete process.env.CLAYFORM_CLOUD_PLAN_LIVE;
    preview("usage-free-80", n.email);
    expect(n.email.subject).toBe("Clayform: you've used 80% of your responses");
    for (const part of [n.email.html, n.email.text]) {
      expect(part).toContain(`${used.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} completed responses this month`);
      expect(part).toContain(`${plans.CLOUD.fair_use.responses.toLocaleString("en-US")} completed responses`);
      expect(part).toContain("$12/month");
      expect(part).toContain(`${ORIGIN}/forms`);
      expect(part).toContain("Nothing has been deleted");
    }
    expect(n.email.html).not.toMatch(/stopped/);
  });

  it("free tier at 100%: says what paused", () => {
    const limit = plans.CLOUD.free.responses;
    const n = plans.noticeFor(status("free"), meter("responses", limit, limit), 100);
    preview("usage-free-100", n.email);
    expect(n.email.subject).toBe("Clayform: you've reached your responses limit");
    expect(n.email.html).toContain("stopped taking new responses");
    expect(n.email.text).toContain("stopped taking new responses");
    expect(n.email.text).toContain(`${ORIGIN}/forms`);

    const s = plans.noticeFor(status("free"), meter("storage", plans.CLOUD.free.storage, plans.CLOUD.free.storage), 100);
    preview("usage-free-storage-100", s.email);
    expect(s.email.text).toContain("stopped taking new file uploads");
  });

  it("OpenCtrl Cloud over fair use: offers a pack, never pauses", () => {
    const limit = plans.CLOUD.fair_use.responses;
    const n = plans.noticeFor(status("cloud"), meter("responses", limit, limit), 100);
    preview("usage-cloud-100", n.email);
    const pack = plans.CLOUD.packs.find((p) => p.adds.responses)!;
    expect(n.email.html).toContain("Add a pack");
    expect(n.email.text).toContain(pack.label);
    expect(n.email.html).not.toMatch(/stopped/);
    expect(n.email.text).toContain("Your forms keep working");
  });

  it("every email has both parts", () => {
    expect(Object.keys(previews).length).toBeGreaterThanOrEqual(5);
    for (const m of Object.values(previews)) {
      expect(m.html.length).toBeGreaterThan(500);
      expect(m.text.length).toBeGreaterThan(50);
    }
  });
});
