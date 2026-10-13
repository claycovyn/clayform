# Clayform — notes for Claude Code

Free, open-source, self-hosted conversational form builder (Next.js 15, React 19, Tailwind, TypeScript).

## Commands
- `npm run dev` · `npm run build` · `npm run typecheck` · `npm test` (vitest: engine, security, form ops, MCP)

## Storage
`src/lib/db.ts` has one async interface with two drivers: Postgres when `DATABASE_URL`/`POSTGRES_URL` is set
(required on Vercel), otherwise SQLite via `node:sqlite` in `CLAYFORM_DATA_DIR`. Keep both drivers in step.

## Accounts
Email + password accounts (`src/lib/auth.ts`, scrypt; session cookie signed with `CLAYFORM_SECRET` and the
user's `passwordChangedAt`). Every form has an `owner_id`; admin routes go through `requireOwnedForm`
(`src/lib/api.ts`) and return 404 for forms you don't own. Webhook targets pass `src/lib/netguard.ts`.
- **Continue with OpenCtrl** (OIDC, `src/lib/openctrlLogin.ts`, routes `/api/auth/openctrl/{start,callback}`): on only
  when `OPENCTRL_CLIENT_ID` + `OPENCTRL_CLIENT_SECRET` are set (`OPENCTRL_ISSUER` defaults to https://openctrl.app).
  Accounts link by `users.openctrl_sub`. An existing account is linked by email only when both sides verified it;
  otherwise the person logs in with its password once (`api/login` finishes the link). Accounts made through OpenCtrl
  have no usable password. Tests: `tests/openctrl-login.test.ts`.

## API keys and MCP
- `src/lib/apiKeys.ts`: keys are `cf_` + 32 random bytes; only the SHA-256 is stored; scopes `forms:read`,
  `forms:write`, `responses:read`, `responses:delete`, `webhooks:write` (default: all but delete).
- `src/lib/api.ts`: `requireUser(req, scope)` / `requireOwnedForm(id, req, scope)` accept the cookie or a bearer key.
  Call them **without** `req` for browser-only routes (account settings, `/api/account/keys`). 120 req/min per key.
- `src/lib/mcp/server.ts`: one stateless `McpServer` per request, bound to the key's owner. Tools validate edits through
  `src/lib/formOps.ts` (pure; throws `FormOpError` with a message the agent can act on). Add a tool there with a scope,
  annotations (`readOnly` / `destructive`) and a test in `tests/mcp.test.ts`. Reference: `docs/MCP.md`.
- Routes: `/api/mcp` and `/api/mcp/mcp`. Uploaded files reach agents as 15-minute signed links (`src/lib/fileLinks.ts`).
- The MCP plumbing (key format, `createOpenCtrlMcp`, `defineTool`, manifest schema) is `src/lib/mcp-kit/`, **vendored**
  from `packages/mcp-kit` in the OpenCtrl repo. Don't edit it here; change it there and copy `src/*.ts` back.
- `openctrl.json` (repo root, served at `/openctrl.json`) is the OpenCtrl manifest. `tests/mcp.test.ts` fails if its
  tools or scopes drift from the code.

## Cloud (plans, metering, abuse) — build plan 7.1–7.2
- Limits come from `openctrl.json` → `cloud` (meters, `free`, `fair_use`, `packs`) via the kit (`entitlementLimits`,
  `usageStatus`); `src/lib/plans.ts` maps `users.plan` (`free` / `cloud` / `grandfathered`; old `pro` = `cloud`) to a
  tier. **Limits only when `CLAYFORM_CLOUD=1`**; self-hosted installs are never limited.
- Free tier at a limit: new respondents / uploads pause (never delete). OpenCtrl Cloud ($12, every Original): never
  paused; over fair use → "add a pack". Notices at 80/100% once per meter per month (`checkUsageNotices`).
- Email: `src/lib/email.ts` (Resend HTTP, no SDK). Verification before publishing: `src/lib/verify.ts`.
- `meter()` never throws. The manifest "emails" meter counts emails sent *for* a workspace (none yet); system emails go
  to `emails_sent` for cost only.
- Abuse: `src/lib/abuse.ts`, `/report/[slug]`, takedowns. Admin: `/admin` (`CLAYFORM_ADMIN_EMAILS`), plans and packs
  set by hand until OpenCtrl billing. Pricing page: `/pricing`. Guide: `docs/CLOUD.md`. Tests: `tests/cloud.test.ts`.

## Hosting
- GitHub: https://github.com/claycovyn/clayform (public, default branch `main`).
- Vercel is on a **Hobby** team owned by `claycovyn`. Hobby only deploys a commit when every author and
  co-author resolves to that account, so commits use `283821699+claycovyn@users.noreply.github.com` and carry
  **no `Co-Authored-By:` trailer**.

## License
AGPL-3.0-only from 2026-10-12, counsel-approved; copyright Clayton Sinclair (MIT up to `f4113ac`). `src/lib/mcp-kit/` stays MIT. See `docs/LICENSING.md`; outside PRs
need the CLA line (`docs/CLA.md`). Check new dependencies' licenses for AGPL compatibility.

## Rules
- Logic lives in `src/lib/engine.ts` and stays pure: the browser and the server both run it.
- The server re-validates everything a respondent sends (`src/lib/submit.ts`).
- Every form field must be in `src/lib/schema.ts`.
- Brand: cobalt `#2F5BFF`, ink `#0B0B12`, Inter Tight display, potter's-wheel mark (`src/components/Logo.tsx`).
- No browser `confirm()` / `prompt()` / `alert()`: use `useConfirm()` / `usePrompt()` from `src/components/ui/Dialog.tsx`
  (store in `src/lib/dialogs.ts`, tests in `tests/dialogs.test.ts`). The respondent Player keeps its own themed UI.
