# Self-hosting Clayform

Free forever. You need a server that can run Node.js, or Docker, or a Vercel account.

## Requirements

| Need | Details |
| --- | --- |
| Runtime | **Node.js 22.13+** (Clayform uses the built-in `node:sqlite`), or Docker |
| Database | **SQLite** (default, one file in `CLAYFORM_DATA_DIR`, nothing to install) or **Postgres** (`DATABASE_URL`; required on Vercel and other hosts with a temporary disk) |
| File storage | Uploads live next to the SQLite file, or inside Postgres. Default limit 10 MB per file (4 MB on Vercel) |
| Secret | `CLAYFORM_SECRET`: any long random string (`openssl rand -hex 32`). Required in production; changing it signs everyone out |
| Email | None needed today |
| Memory / CPU | A small VPS (1 vCPU, 512 MB–1 GB RAM) handles a typical install |

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `CLAYFORM_SECRET` | none | Signs sessions and file links. Required in production |
| `DATABASE_URL` / `POSTGRES_URL` | unset → SQLite | Use Postgres |
| `CLAYFORM_DATA_DIR` | `./data` | SQLite file and uploads |
| `NEXT_PUBLIC_SITE_URL` | request origin | Public address for share links, embeds, MCP and `/openctrl.json` |
| `CLAYFORM_SIGNUPS` | `open` | `closed` stops new sign-ups once your account exists |
| `CLAYFORM_MAX_UPLOAD_MB` | 10 (4 on Vercel) | Upload size cap |
| `CLAYFORM_ALLOW_PRIVATE_WEBHOOKS` | off | `1` allows webhooks to private network addresses |
| `CLAYFORM_SOURCE_URL` | the official repo | Your fork's address, if you've changed Clayform (see below) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | **Continue with Google** on the log-in and sign-up pages (both needed). In Google Cloud, create an OAuth client (Web application) with the authorized redirect URI `https://<your site>/api/auth/google/callback` |
| `OPENCTRL_CLIENT_ID`, `OPENCTRL_CLIENT_SECRET` | unset | **Continue with OpenCtrl** (both needed). Redirect URI `https://<your site>/api/auth/openctrl/callback`; `OPENCTRL_ISSUER` overrides https://openctrl.app |

`CLAYFORM_CLOUD`, `CLAYFORM_ADMIN_EMAILS` and `CLAYFORM_SUPPORT_EMAIL` are for the hosted service
([docs/CLOUD.md](CLOUD.md)). Leave them unset: a self-hosted Clayform has no plans and no limits.

## Install

- **Node**: `npm ci && npm run build && npm start`
- **Docker**: `CLAYFORM_SECRET=$(openssl rand -hex 32) docker compose up -d` (data in the `clayform-data` volume)
- **Vercel**: import the repo, add a Postgres database (Neon or Supabase), set `CLAYFORM_SECRET`, redeploy.

## Backups

- **SQLite**: back up `CLAYFORM_DATA_DIR` (the `clayform.db` file, its `-wal` file, and `uploads/`). Use
  `sqlite3 clayform.db ".backup backup.db"` for a consistent copy while running.
- **Postgres**: `pg_dump` the database (uploads are inside it).
- Forms can also be exported one by one as JSON, and responses as CSV/JSON, from the app or the API.

## Upgrading

Pull the new version and rebuild. Tables and columns are created or added on start, for both SQLite and Postgres;
there's no separate migration step. Back up first.

## Your obligations under the AGPL-3.0

- Running Clayform unchanged, for yourself or for others: keep the license notice. That's all.
- Running a **modified** Clayform that other people use over the network: offer them your modified source under the
  AGPL. The simplest way: publish your fork and set `CLAYFORM_SOURCE_URL` to it, so the home page and `/source`
  link there. See [LICENSING.md](LICENSING.md).
