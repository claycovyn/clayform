<p align="center">
  <img src="public/logo.svg" alt="Clayform" width="320">
</p>

<p align="center"><b>Forms people actually finish. Free forever.</b><br>
A beautiful, conversational, open-source form builder you host yourself.<br>
No response limits. No paywalled features. No monthly bill.</p>

<p align="center">
  <img src="docs/screenshots/builder.png" alt="The Clayform builder" width="860">
</p>

---

## Why Clayform exists

One-question-at-a-time forms get more people to the end. The tools that made them popular charge for it, and their reviews keep raising the same complaints:

| What reviewers complain about | What Clayform does |
| --- | --- |
| Prices go up fast once you need more responses | **$0.** MIT licensed. Run it on a $5 server, a Raspberry Pi or your laptop. |
| Small monthly response caps that stop a form mid-campaign | **No caps.** Your server, your SQLite file. Set a limit only if *you* want one. |
| Useful features (logic, branding removal, partial responses) locked to higher tiers | **Everything unlocked**: logic, scoring, hidden fields, file uploads, webhooks, custom endings, no badge. |
| Thin reporting | **Drop-off per question**, NPS calculated, completion rate, average time, endings reached. |
| Buggy or clumsy CSV exports | **Clean CSV** (Excel-safe UTF-8, protected against formula injection), JSON export, signed webhooks. |
| Respondents lose everything if they close the tab | **Save & resume**: answers save as people go; they can pick up later or copy a link to finish on another device. |
| Spotty connections lose submissions | **Offline-safe**: if the network drops, answers wait on the device and send when it's back. |
| No bulk editing | **Bulk-paste options**, duplicate questions, **undo/redo** across the whole builder. |
| Locked into one vendor | **Forms as code**: every form is plain JSON you can back up, diff in Git and import anywhere. |

<p align="center">
  <img src="docs/screenshots/player.png" alt="A Clayform form" width="420">
  <img src="docs/screenshots/results.png" alt="Results" width="420">
</p>

## Features

- **18 question types**: short text, long text, email, phone, number, website, multiple choice (single/multi, “Other”, shuffle), picture choice, dropdown (searchable), yes/no, ranking (drag or arrows), star rating, opinion scale, NPS, date, file upload, consent and statement.
- **Two layouts**: one question at a time, or a classic one-page form. Same logic engine either way.
- **Logic jumps** that read like English: *if* an answer, hidden field or score *is / contains / is at least …* *then* go to a question or a specific ending. AND/OR conditions.
- **Scoring** for quizzes and lead scoring, with **endings chosen by score range**.
- **Answer recall**: `Thanks {{name}}!`, `You scored {{score}}`, plus hidden fields from the URL (`?source=newsletter`).
- **Keyboard first**: Enter to continue, A/B/C to pick options, Y/N, number keys for scales, ⌥↑/⌥↓ to move.
- **Themes**: 8 presets plus your own colours, fonts, corner radius, background images. The designer warns you about low contrast.
- **Live builder preview** on desktop and mobile widths, with autosave and undo.
- **Embeds**: inline, popup or plain iframe from one script tag, with hidden fields and a `clayform:submit` event.
- **Results**: summaries per question, a searchable response table, partial responses, response detail, bulk delete.
- **Webhooks** on every completed response, optionally signed with HMAC-SHA256.
- **AI-ready**: a built-in **MCP server** and API keys, so an assistant like Grok, Claude or ChatGPT can build forms, publish them and read your results for you.
- **Schedule & limits**: close on a date, after N responses, or by hand.
- **Accessible**: real labels and roles, focus management, visible errors announced to screen readers, Reduce Motion respected.
- **Private**: no third-party trackers. Uploaded files can only be downloaded from the dashboard.

## Quick start

Requires **Node.js 22.13+** (Clayform uses Node's built-in SQLite, so there's no database to install).

```bash
git clone https://github.com/claycovyn/clayform
cd clayform
npm install
npm run dev
```

Open http://localhost:3000, click **Sign up free** and create your account. Everyone who signs up gets their own private dashboard.

### Run it for real

```bash
cp .env.example .env.local     # set CLAYFORM_SECRET
npm run build
npm start
```

### Docker

```bash
CLAYFORM_SECRET=$(openssl rand -hex 32) docker compose up -d
```

Data (the SQLite database and uploaded files) lives in the `clayform-data` volume. Back it up by copying `/data`.

### Deploy on Vercel

Vercel's servers have no permanent disk, so on Vercel Clayform stores everything in Postgres. A free Neon or Supabase database is enough.

1. On [vercel.com/new](https://vercel.com/new), import this repository (or your fork).
2. Under **Environment Variables**, add `CLAYFORM_SECRET` (any long random string). Click **Deploy**.
3. In the new project, open **Storage → Create Database**, pick **Neon** (Postgres, free tier), and connect it to the project. This adds `DATABASE_URL` for you.
4. Open **Deployments**, click the **⋯** menu on the latest deployment, and choose **Redeploy**. Clayform creates its tables on first use.
5. Open your site and click **Sign up free**. Your account is the first one; anyone else can sign up too unless you set `CLAYFORM_SIGNUPS=closed`.
6. Optional: set `NEXT_PUBLIC_SITE_URL` to your domain so share links and embed code use it.

On Vercel, file uploads are capped at 4 MB (Vercel's request-size limit). Files are stored in the database.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `CLAYFORM_SECRET` | — | Signs login sessions. **Required in production.** Use `openssl rand -hex 32`. |
| `CLAYFORM_SIGNUPS` | `open` | Set to `closed` to stop new accounts (for a private, self-hosted install). |
| `CLAYFORM_ALLOW_PRIVATE_WEBHOOKS` | — | Set to `1` to let webhooks call private network addresses. Off by default so users can't reach your internal network. |
| `DATABASE_URL` | — | Postgres connection string. When set (also read from `POSTGRES_URL`), Clayform uses Postgres instead of SQLite. Required on Vercel. |
| `CLAYFORM_DATA_DIR` | `./data` | Where `clayform.db` and `uploads/` live (SQLite only). |
| `NEXT_PUBLIC_SITE_URL` | request origin | Public URL used in share links and embed code. |
| `CLAYFORM_MAX_UPLOAD_MB` | `10` (`4` on Vercel) | Max size for file-upload answers. |

## Embedding

```html
<!-- Inline -->
<div data-clayform="your-form-slug" style="height:560px"></div>
<!-- Popup -->
<button data-clayform-popup="your-form-slug" data-clayform-hidden="plan=pro">Get started</button>

<script src="https://forms.example.com/embed.js" async></script>
<script>
  window.addEventListener("message", (e) => {
    if (e.data?.type === "clayform:submit") console.log("Submitted", e.data.responseId);
  });
</script>
```

## Webhooks

Each completed response is `POST`ed as JSON:

```json
{
  "event": "response.completed",
  "form": { "id": "…", "slug": "…", "title": "Let's talk" },
  "response": {
    "id": "…", "startedAt": "…", "completedAt": "…", "score": 0, "ending": "Thanks!",
    "hidden": { "source": "newsletter" },
    "answers": [{ "ref": "email", "type": "email", "question": "What's your email?", "value": "ada@example.com" }]
  }
}
```

With a signing secret set, verify the `X-Clayform-Signature` header:

```js
const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
```

## Connect an AI agent (MCP)

Clayform has a built-in [MCP](https://modelcontextprotocol.io) server, so an AI assistant can work in your account:
create a form, add questions, set logic and a theme, publish it, hand you the link, then read responses and stats.

1. Open **Account → AI agents and API keys** and create a key (for example “Grok Bot”). Pick what it may do.
   Deleting responses is off unless you tick it. The key (`cf_…`) is shown once; only its hash is stored.
2. In your assistant, add a custom MCP server (Streamable HTTP):
   - URL: `https://<your-clayform>/api/mcp` (also served at `/api/mcp/mcp`)
   - Header: `Authorization: Bearer cf_…`
3. Ask it something like *“Make a 3-question lunch poll, publish it and give me the link.”*

Tools: `list_field_types`, `list_forms`, `get_form`, `create_form`, `update_form`, `delete_form`, `add_field`,
`update_field`, `remove_field`, `reorder_fields`, `set_logic`, `set_endings`, `set_theme`, `update_settings`,
`publish_form`, `unpublish_form`, `get_share_links`, `list_responses`, `get_response`, `get_stats`, `export_responses`,
`delete_responses`, `get_file`, `set_webhook`, `test_webhook`. Full reference: [docs/MCP.md](docs/MCP.md).

The same keys work on the JSON API (`/api/forms`, `/api/forms/:id`, `/api/forms/:id/responses?limit=50&cursor=…`,
`/api/forms/:id/export`), each route checking the key's permissions. Keys are limited to 120 requests a minute and can
be revoked at any time. Key management itself (and account settings) only works signed in, never with a key.

Try it with the MCP Inspector: `npx @modelcontextprotocol/inspector`, transport “Streamable HTTP”, your URL, and the
`Authorization` header.

## Forms as code

Download any form as JSON from **Share → Download form JSON**, and import it with **Import JSON** on the dashboard. The schema is validated on import ([`src/lib/schema.ts`](src/lib/schema.ts)), so a hand-edited file can't break an install.

## How it's built

- **Next.js 15** (App Router) + **React 19** + **Tailwind CSS**, TypeScript throughout.
- **One engine, two sides**: [`src/lib/engine.ts`](src/lib/engine.ts) holds logic, scoring, recall and validation as pure functions. The player runs it in the browser; the API runs it again on the server, so a tampered request can't skip a required question, pick an option that doesn't exist or land on the wrong ending.
- **Storage**: SQLite (`node:sqlite`, WAL mode) when self-hosting, Postgres when `DATABASE_URL` is set. Both sit behind one interface in [`src/lib/db.ts`](src/lib/db.ts); forms and responses are stored as JSON documents.
- **No tracking, no external services.** Fonts load from Google Fonts; remove the `<link>` in `src/app/layout.tsx` to self-host them.

```
src/
  lib/engine.ts        logic jumps, scoring, recall, validation (shared)
  lib/submit.ts        partial saves, resume tokens, completion, webhooks
  lib/db.ts            storage (SQLite or Postgres)
  lib/formOps.ts       validated single-step form edits (used by the MCP server)
  lib/apiKeys.ts       API keys and permissions
  lib/mcp/             the MCP server and its HTTP handler
  components/player/   the form respondents see
  components/builder/  build, logic, design, settings, share
  components/results/  summary, responses, drop-off
  app/api/             JSON API
public/embed.js        the embed script
```

## Development

```bash
npm run dev         # local server with hot reload
npm test            # engine, security, form-ops and MCP tests (vitest)
# Run the MCP tests against Postgres too:
CLAYFORM_TEST_DATABASE_URL=postgres://… npx vitest run tests/mcp.test.ts
npm run typecheck
npm run build
```

## Roadmap

Ideas we'd love help with: teams and shared workspaces, password reset by email, email notifications, payment questions (Stripe), signature and address questions, translations, A/B testing of question wording, a visual logic map, Google Sheets sync.

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Clayform is an independent project, written from scratch. It is not affiliated with, endorsed by or derived from the code of any other form product. Product names mentioned anywhere belong to their owners.
