# Running Clayform as OPENCTRL Cloud

This is for the hosted service (clayform.vercel.app). **Self-hosters don't need any of it:** without
`CLAYFORM_CLOUD=1` there are no plans and no limits, and every feature works.

## Switches

| Variable | What it does |
| --- | --- |
| `CLAYFORM_CLOUD=1` | Enforces plan limits, shows **Report** on public forms, refuses to publish forms that collect credentials, and gives new sign-ups **Free Cloud** |
| `CLAYFORM_ADMIN_EMAILS` | Comma-separated emails that can open `/admin` (signed in with a browser session) |
| `CLAYFORM_SUPPORT_EMAIL` | Shown to owners whose form was taken down, so they can appeal |

## Plans (`src/lib/plans.ts`)

| Plan | Price | Limits |
| --- | --- | --- |
| Free Cloud | $0 | 100 completed responses a month per workspace (UTC calendar month). Storage, upload and email caps: set from metering data before launch (build plan 7.2) |
| Pro Cloud | $9/mo | No response cap (fair-use thresholds set from data before Pro launches) |
| Early account (`grandfathered`) | $0 | No caps. Every account that existed before `CLAYFORM_CLOUD=1` was turned on keeps this |

At the limit, **new** respondents see "This form isn't taking new responses right now". People already part-way
through can finish. Nothing is deleted, and export (JSON/CSV, API, MCP) keeps working. The owner sees the usage bar
and the pause notice on the dashboard. Email notices come with an email provider (not set up yet). Until Stripe billing
(build plan 7.3), an admin sets plans by hand on `/admin`.

## Metering (from day one)

Per workspace (the account), per UTC day, in `usage_daily`: `responses_started`, `responses_completed`,
`uploads_bytes`, `api_requests` (API key and MCP calls), `emails_sent` (0 until email exists), `support_tickets`
(logged by an admin with **+1**). Stored bytes (form and response documents plus uploads) are measured live. Metering
runs on self-hosted installs too, for their own numbers; a metering failure is logged and never breaks a request.

## Cost to serve (`/admin`)

Enter unit costs from the real bills (storage and backups per GB-month, uploads per GB, per 1,000 responses, per
1,000 API requests, per 1,000 emails, per support ticket, fixed monthly cost shared across workspaces). They start at
$0 so nothing is invented. `/admin` then shows each workspace's usage, estimated cost, revenue (the plan price for now)
and margin for any month, lowest margin first, with totals.

## Abuse prevention

- **Credential harvesting is refused on the Cloud**: forms asking for passwords, card numbers or CVV, wallet recovery
  phrases or private keys, social security numbers, or login codes can't be published (builder, API and MCP).
- **Impersonation is flagged**: a brand name with a login or verification lure in the title shows under "Flagged
  published forms" on `/admin`.
- **Reports**: every public form has a **Report** link (`/report/<slug>`; 5 reports an hour per IP). Reports wait on
  `/admin` to be dismissed or acted on.
- **Takedowns**: one click on `/admin`. The public link shows a removal notice, submissions stop, and republishing
  doesn't undo it; the owner sees "Removed" and the reason on their dashboard. **Restore** undoes it.
- **Rate limits**: 120 submissions a minute per IP, 300 new responses a minute per workspace, 120 API requests a minute
  per key, 20 uploads a minute per IP.
- **Not yet**: email verification before publishing, which needs an email provider. It's the next abuse step once
  email is added.
