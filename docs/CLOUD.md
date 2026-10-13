# Running Clayform as OpenCtrl Cloud

This is for the hosted service (clayform.vercel.app). **Self-hosters don't need any of it:** without
`CLAYFORM_CLOUD=1` there are no plans and no limits, and every feature works.

## Switches

| Variable | What it does |
| --- | --- |
| `CLAYFORM_CLOUD=1` | Enforces plan limits, shows **Report** on public forms, refuses to publish forms that collect credentials, gives new sign-ups **Free Cloud**, and adjusts the home page copy |
| `CLAYFORM_CLOUD_PLAN_LIVE=1` | The OpenCtrl Cloud subscription can be bought. Free-tier usage notices then offer "Join OpenCtrl Cloud for $12/month". Unset (today): they say "OpenCtrl Cloud is coming soon: one subscription for every OpenCtrl app with much higher limits." and show no price |
| `CLAYFORM_ADMIN_EMAILS` | Comma-separated emails that can open `/admin` (signed in with a browser session) |
| `CLAYFORM_SUPPORT_EMAIL` | Shown to owners whose form was taken down, so they can appeal |

## Plans and limits (`src/lib/plans.ts`, limits from `openctrl.json`)

Limits live in this app's `openctrl.json` → `cloud` (meters, `free`, `fair_use`, `packs`) and are computed with the
OpenCtrl kit (`entitlementLimits`, `usageStatus`), so every Original works the same way.

| Plan (`users.plan`) | Price | Limits | Going over |
| --- | --- | --- | --- |
| `free`: Free Cloud | $0 | `cloud.free` (Clayform: 100 completed responses a month, 0.25 GB storage) | New respondents see a pause notice (people mid-form can finish); new uploads are refused when storage is full. Prompt: join OpenCtrl Cloud |
| `cloud`: OpenCtrl Cloud | $12/month for **every** Original | `cloud.fair_use` + packs (Clayform: 10,000 responses a month, 5 GB) | **Never paused.** Usage shows as over fair use, and the prompt is to add a pack |
| `grandfathered`: Early account | $0 | None | Accounts that existed before `CLAYFORM_CLOUD=1` was turned on |

Older rows with `plan = "pro"` are read as `cloud`. Packs (`responses_10k`, `storage_10gb`) and plans are set by an
admin on `/admin` until OpenCtrl billing (build plan 7.3) sets them from Stripe. **No data is ever deleted for going
over**, and export works on every plan.

**Usage notices**: at 80% and 100% of each limited meter, once per meter per month, by email (needs Resend, below) and
on the dashboard. Free: "Join OpenCtrl Cloud for $12/month" once `CLAYFORM_CLOUD_PLAN_LIVE=1`, otherwise "OpenCtrl
Cloud is coming soon". Subscribers: "Add a pack".

**Email verification**: with Cloud on *and* email configured, a new account confirms its email before it can publish
(link valid 3 days; "Resend link" on the dashboard; an admin can confirm by hand). Grandfathered accounts are treated as
confirmed.

## Email (Resend)

| Variable | |
| --- | --- |
| `RESEND_API_KEY` | Resend API key. Without it nothing is sent (messages are logged), verification isn't required, and `/admin` warns |
| `CLAYFORM_EMAIL_FROM` | Sender, e.g. `Clayform <hello@yourdomain>` (a domain verified in Resend). Required to send |
| `OPENCTRL_CLOUD_URL` | Where "Upgrade" links go once OpenCtrl billing exists. Unset: "Coming soon" |

## Metering (from day one)

Per workspace (the account), per UTC day, in `usage_daily`: `responses_started`, `responses_completed`,
`uploads_bytes`, `api_requests` (API key and MCP calls), `emails_sent` (Clayform's own account and usage emails, for
cost only; they never count against the workspace's "emails" limit), `support_tickets`
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
- **Email verification** before publishing (see above).
