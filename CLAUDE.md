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

## API keys and MCP
- `src/lib/apiKeys.ts`: keys are `cf_` + 32 random bytes; only the SHA-256 is stored; scopes `forms:read`,
  `forms:write`, `responses:read`, `responses:delete`, `webhooks:write` (default: all but delete).
- `src/lib/api.ts`: `requireUser(req, scope)` / `requireOwnedForm(id, req, scope)` accept the cookie or a bearer key.
  Call them **without** `req` for browser-only routes (account settings, `/api/account/keys`). 120 req/min per key.
- `src/lib/mcp/server.ts`: one stateless `McpServer` per request, bound to the key's owner. Tools validate edits through
  `src/lib/formOps.ts` (pure; throws `FormOpError` with a message the agent can act on). Add a tool there with a scope,
  annotations (`readOnly` / `destructive`) and a test in `tests/mcp.test.ts`. Reference: `docs/MCP.md`.
- Routes: `/api/mcp` and `/api/mcp/mcp`. Uploaded files reach agents as 15-minute signed links (`src/lib/fileLinks.ts`).

## Hosting
- GitHub: https://github.com/claycovyn/clayform (public, default branch `main`).
- Vercel is on a **Hobby** team owned by `claycovyn`. Hobby only deploys a commit when every author and
  co-author resolves to that account, so commits use `283821699+claycovyn@users.noreply.github.com` and carry
  **no `Co-Authored-By:` trailer**.

## Rules
- Logic lives in `src/lib/engine.ts` and stays pure: the browser and the server both run it.
- The server re-validates everything a respondent sends (`src/lib/submit.ts`).
- Every form field must be in `src/lib/schema.ts`.
- Brand: cobalt `#2F5BFF`, ink `#0B0B12`, Inter Tight display, potter's-wheel mark (`src/components/Logo.tsx`).
