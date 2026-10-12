// openctrl.json: the file each OPENCTRL app keeps at the root of its repository (and serves at /openctrl.json).
// It describes the app and how an AI agent connects to it. OPENCTRL reads it to fill a listing; anything it shows as
// a fact (savings, "Works with AI") is still checked by a person or an automated check first.
import { z } from "zod";

const https = z.string().url().refine((v) => v.startsWith("https://"), "Must be an https:// URL.");

export const MANIFEST_VERSION = 1;

export const manifestSchema = z
  .object({
    openctrl: z.literal(MANIFEST_VERSION).describe("Manifest format version."),
    name: z.string().min(1).max(80),
    tagline: z.string().max(160).optional(),
    /** Products this replaces, by name (e.g. "Typeform"). */
    alternative_to: z.array(z.string().min(1).max(80)).max(20).default([]),
    /** An OPENCTRL category slug, e.g. "forms-surveys". */
    category: z.string().regex(/^[a-z0-9-]{2,60}$/).optional(),
    website: https.optional(),
    repository: https.optional(),
    license: z.string().max(60).optional(),
    icon: https.optional(),
    pricing: z
      .object({
        model: z.enum(["free", "freemium", "one_time", "subscription", "open_source"]),
        notes: z.string().max(300).optional(),
      })
      .optional(),
    /** The maker's own claim. OPENCTRL shows savings only after an admin checks them against public pricing. */
    savings_pct: z.number().min(0).max(100).nullable().optional(),
    mcp: z
      .object({
        url: https,
        transport: z.literal("streamable-http").default("streamable-http"),
        auth: z.enum(["api_key", "oauth", "none"]),
        /** Where people create a key or sign in. */
        get_key_url: https.optional(),
        header: z.string().max(80).default("Authorization: Bearer <key>"),
        scopes: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9_:.-]{1,60}$/), description: z.string().max(200) })).max(40).default([]),
        tools: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)).max(200).optional(),
        docs: https.optional(),
      })
      .optional(),
  })
  .strict();

export type OpenCtrlManifest = z.infer<typeof manifestSchema>;
export type OpenCtrlManifestInput = z.input<typeof manifestSchema>;

export function parseManifest(input: unknown): { ok: true; manifest: OpenCtrlManifest } | { ok: false; error: string } {
  const r = manifestSchema.safeParse(input);
  if (r.success) return { ok: true, manifest: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: `${issue.path.join(".") || "openctrl.json"}: ${issue.message}` };
}
