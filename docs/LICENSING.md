# Licensing

**Decision (2026-10-12, by the sole copyright holder; approved by counsel):** Clayform is licensed under the
**GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`) from this change on.

> This page explains the decision in plain words; it isn't legal advice, and the [LICENSE](../LICENSE) file is what
> counts.

## Why AGPL-3.0

Clayform is an OPENCTRL Original: free to use and self-host, with OPENCTRL Cloud offering a hosted version as a paid
service. Under MIT, anyone could take Clayform, change it, and sell it as a hosted service without sharing those
changes. The AGPL keeps Clayform free for everyone while asking one thing of people who run a **modified** version for
others over a network: offer those users the modified source (section 13).

`-only` (not `-or-later`) so future license versions are a decision for the copyright holder, not automatic.

## What it means for you

| You… | What the AGPL asks |
| --- | --- |
| Use Clayform at clayform.vercel.app | Nothing. |
| Self-host Clayform unchanged, for yourself or your company | Nothing beyond keeping the license notice. |
| Change Clayform and use it only inside your organisation | Nothing to publish. |
| Change Clayform and let other people use it over the network (your customers, the public) | Offer those users your changed source code, under the AGPL. Set `CLAYFORM_SOURCE_URL` to your fork so the home page and `/source` link to it. |
| Embed a Clayform form on your website | Nothing: your site isn't a derivative of Clayform. |
| Build on Clayform's JSON API or MCP server from your own app | Nothing: talking to Clayform over its API doesn't put your app under the AGPL. |

## Earlier versions stay MIT

Everything published up to and including commit `f4113ac` (2026-10-12) was released under the MIT license, and anyone
who received it keeps those MIT rights. The AGPL applies to versions after the change.

## What stays MIT

- `src/lib/mcp-kit/`: vendored from `@openctrl/mcp-kit`, MIT (see its `LICENSE`), so any app can adopt it.

## Dependencies

All production dependencies are compatible with AGPL-3.0 (checked 2026-10-12 with `npm ls --omit=dev`): MIT, ISC,
Apache-2.0, BSD-2/3-Clause, 0BSD, Unlicense; LGPL-3.0-or-later (`sharp`'s libvips binaries, optional, used by Next.js
image handling); CC-BY-4.0 (`caniuse-lite` browser data, build time). Re-check when adding a dependency; avoid
licenses that conflict with the AGPL (for example SSPL, BUSL, or "non-commercial" terms).

## Contributions

Outside contributions are accepted under the [Contributor License Agreement](CLA.md), so the project can keep choosing
its license (for example to offer a commercial license to companies that can't use the AGPL).

## Copyright holder

Clayton Sinclair (GitHub: claycovyn), sole author of every commit to date.
