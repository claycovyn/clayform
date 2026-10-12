# Clayform — notes for Claude Code

Free, open-source, self-hosted conversational form builder (Next.js 15, React 19, Tailwind, TypeScript).

## Commands
- `npm run dev` · `npm run build` · `npm run typecheck` · `npm test` (engine tests, vitest)

## Storage
`src/lib/db.ts` has one async interface with two drivers: Postgres when `DATABASE_URL`/`POSTGRES_URL` is set
(required on Vercel), otherwise SQLite via `node:sqlite` in `CLAYFORM_DATA_DIR`. Keep both drivers in step.

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
