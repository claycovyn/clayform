# Clayform MCP server

Endpoint: `https://<your-clayform>/api/mcp` (also `/api/mcp/mcp`). Transport: Streamable HTTP, stateless, JSON
responses. Auth: `Authorization: Bearer cf_…` on every request (create keys under **Account → AI agents and API keys**).
A request without a valid, unrevoked key gets `401` with `WWW-Authenticate: Bearer`.

Each tool needs a permission (scope) on the key. A tool the key can't use answers with an error naming the missing
scope. Errors are plain sentences meant for the agent to act on, never stack traces.

| Tool | Scope | What it does |
| --- | --- | --- |
| `list_field_types` | — | The 18 question types and their options, logic operators, theme presets |
| `list_forms` | forms:read | Forms with status and view/start/complete counts |
| `get_form(form_id)` | forms:read | Full form document (webhook secret hidden) |
| `get_share_links(form_id)` | forms:read | Public URL and inline/popup/iframe embed code |
| `create_form(title, fields?)` | forms:write | New draft, optionally with questions |
| `update_form(form_id, title?, slug?, welcome?, hidden_fields?)` | forms:write | Title, link, welcome screen, hidden fields |
| `delete_form(form_id)` ⚠ | forms:write | Deletes the form, its responses and files |
| `add_field(form_id, type, title, ref?, required?, description?, choices?, properties?, position?)` | forms:write | Adds a question |
| `update_field(form_id, ref, patch)` | forms:write | Edits a question; renaming `ref` updates logic |
| `remove_field(form_id, ref)` ⚠ | forms:write | Removes a question and the rules that use it |
| `reorder_fields(form_id, refs[])` | forms:write | New order (every ref once; logic must still jump forward) |
| `set_logic(form_id, rules[])` | forms:write | Replaces logic: `{from, match?, conditions:[{source, op, value?}], go_to}` |
| `set_endings(form_id, endings[])` | forms:write | Replaces endings (keep `id` to keep rules that point at one) |
| `set_theme(form_id, preset?, bg?, text?, accent?, button_text?, font?, radius?, align?, background_image?)` | forms:write | Look and feel |
| `update_settings(form_id, …)` | forms:write | Layout, progress, resume, closing, response limit, branding |
| `publish_form(form_id)` | forms:write | Goes live; refuses with a list of problems if the form isn't ready |
| `unpublish_form(form_id)` | forms:write | Back to draft; responses kept |
| `list_responses(form_id, completed_only?, since?, limit?, cursor?)` | responses:read | Newest first, paged with `next_cursor` |
| `get_response(response_id)` | responses:read | One response |
| `get_stats(form_id)` | responses:read | Views, starts, completes, rates, average time, drop-off per question, NPS |
| `export_responses(form_id, format: csv\|json, status?)` | responses:read | Whole export as text (cut off near 900 KB) |
| `get_file(file_id)` | responses:read | 15-minute signed download link |
| `delete_responses(form_id, ids[])` ⚠ | responses:delete | Deletes responses |
| `set_webhook(form_id, url \| null, secret?)` | webhooks:write | Response webhook (private network addresses refused) |
| `test_webhook(form_id)` | webhooks:write | Sends a sample payload and reports the result |

⚠ = `destructiveHint: true`. Read tools carry `readOnlyHint: true`.

Logic conditions: `source` is a question ref, `"score"`, or `"hidden:<name>"`; `op` is one of `is`, `is_not`,
`contains`, `not_contains`, `starts_with`, `gt`, `lt`, `gte`, `lte`, `answered`, `not_answered`; `go_to` is a later
question's ref or `"ending:<id>"`.

## Example (curl)

```bash
KEY=cf_…; URL=https://<your-clayform>/api/mcp
H=(-H "authorization: Bearer $KEY" -H "content-type: application/json" -H "accept: application/json, text/event-stream")
curl -s "${H[@]}" $URL -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -s "${H[@]}" $URL -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_form","arguments":{"title":"Lunch poll","fields":[{"type":"multiple_choice","title":"What for lunch?","choices":["Tacos","Sushi"]}]}}}'
```

## Notes for hosting

- On Vercel, Clayform must use Postgres (`DATABASE_URL`); it refuses to start on SQLite there. The `clayform_api_keys`
  table is created automatically.
- The per-key rate limit (120/min) is in memory, so on serverless it applies per instance.
- OAuth (one-click "Connect" without copying a key) is planned; until then, keys are the way in.
