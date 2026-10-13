// Branded HTML + plain-text email bodies for everything Clayform sends. Pure (no server-only, no I/O), so tests and
// previews can render it. Table layout, inline styles, 600px max: built for Gmail, Apple Mail and Outlook. The logo is
// an absolute PNG URL from the site (email clients don't render SVG). Every string that goes into the HTML is escaped.

export interface EmailMessage {
  subject: string;
  html: string;
  text: string;
}

export type EmailBlock =
  | { type: "paragraph"; text: string }
  /** A primary call to action. The plain-text part shows the label and the URL. */
  | { type: "button"; label: string; href: string }
  /** A URL shown in full so it can be copied (e.g. a fallback for the button). */
  | { type: "link"; label: string; href: string }
  /** A usage figure with a bar, e.g. "800 of 1,000 responses this month". */
  | { type: "meter"; label: string; value: string; pct: number }
  /** Small grey print, e.g. how long a link lasts. */
  | { type: "fineprint"; text: string };

export interface EmailContent {
  subject: string;
  /** Inbox preview text, hidden in the body. */
  preheader: string;
  heading: string;
  blocks: EmailBlock[];
  /** Why the reader got this email, shown in the footer. */
  reason?: string;
  /** Site origin for the logo and the footer link. */
  siteUrl: string;
  /** Source code link for the footer (default: CLAYFORM_SOURCE_URL, then the official repo). */
  sourceUrl?: string;
}

export const DEFAULT_SOURCE_URL = "https://github.com/claycovyn/clayform";

const COBALT = "#2F5BFF";
const INK = "#0B0B12";
const MUTED = "#5B5B6B";
const LINE = "#E6E6EE";
const CANVAS = "#F4F4F8";
const FONT = "'Inter Tight', 'Helvetica Neue', Helvetica, Arial, sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Only http(s) and mailto links make it into an email; anything else becomes "#". */
function safeHref(href: string): string {
  return /^(https?:\/\/|mailto:)/i.test(href) ? escapeHtml(href) : "#";
}

function blockHtml(b: EmailBlock): string {
  switch (b.type) {
    case "paragraph":
      return `<p class="cf-text" style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">${escapeHtml(b.text)}</p>`;
    case "button":
      return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;"><tr>
<td align="center" bgcolor="${COBALT}" style="border-radius:10px;mso-padding-alt:14px 26px;">
<a href="${safeHref(b.href)}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">${escapeHtml(b.label)}</a>
</td></tr></table>`;
    case "link":
      return `<p class="cf-muted" style="margin:0 0 6px;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};">${escapeHtml(b.label)}</p>
<p style="margin:0 0 20px;font-family:${FONT};font-size:13px;line-height:20px;word-break:break-all;"><a href="${safeHref(b.href)}" target="_blank" style="color:${COBALT};text-decoration:underline;">${escapeHtml(b.href)}</a></p>`;
    case "meter": {
      const pct = Math.max(0, Math.min(100, Math.round(b.pct)));
      const fill = pct >= 100 ? "#E5484D" : COBALT;
      const bar =
        pct === 0
          ? `<td class="cf-track" bgcolor="${LINE}" style="height:8px;font-size:0;line-height:0;border-radius:4px;">&nbsp;</td>`
          : pct === 100
            ? `<td bgcolor="${fill}" style="height:8px;font-size:0;line-height:0;border-radius:4px;">&nbsp;</td>`
            : `<td width="${pct}%" bgcolor="${fill}" style="height:8px;font-size:0;line-height:0;border-radius:4px 0 0 4px;">&nbsp;</td><td class="cf-track" bgcolor="${LINE}" style="height:8px;font-size:0;line-height:0;border-radius:0 4px 4px 0;">&nbsp;</td>`;
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="cf-panel" style="border-collapse:separate;margin:4px 0 20px;background:${CANVAS};border-radius:12px;"><tr><td style="padding:18px 20px;">
<p class="cf-muted" style="margin:0 0 4px;font-family:${FONT};font-size:13px;line-height:18px;color:${MUTED};">${escapeHtml(b.label)}</p>
<p class="cf-text" style="margin:0 0 12px;font-family:${FONT};font-size:20px;line-height:26px;font-weight:700;color:${INK};">${escapeHtml(b.value)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${bar}</tr></table>
</td></tr></table>`;
    }
    case "fineprint":
      return `<p class="cf-muted" style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};">${escapeHtml(b.text)}</p>`;
  }
}

function blockText(b: EmailBlock): string {
  switch (b.type) {
    case "paragraph":
    case "fineprint":
      return b.text;
    case "button":
      return `${b.label}: ${b.href}`;
    case "link":
      return `${b.label}\n${b.href}`;
    case "meter":
      return `${b.label}: ${b.value}`;
  }
}

export function renderEmail(c: EmailContent): EmailMessage {
  const site = c.siteUrl.replace(/\/$/, "");
  const source = c.sourceUrl || process.env.CLAYFORM_SOURCE_URL || DEFAULT_SOURCE_URL;
  const logo = `${site}/icon-512.png`;
  const body = c.blocks.map(blockHtml).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(c.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
  @media (max-width:620px) { .cf-pad { padding-left:24px !important; padding-right:24px !important; } }
  @media (prefers-color-scheme: dark) {
    .cf-canvas { background:#0B0B12 !important; }
    .cf-card { background:#16161F !important; border-color:#2A2A36 !important; }
    .cf-panel { background:#1F1F2A !important; }
    .cf-track { background:#2A2A36 !important; }
    .cf-text, .cf-word { color:#F4F4F8 !important; }
    .cf-muted { color:#A6A6B5 !important; }
    .cf-rule { border-color:#2A2A36 !important; }
  }
  [data-ogsc] .cf-text, [data-ogsc] .cf-word { color:#F4F4F8 !important; }
  [data-ogsc] .cf-muted { color:#A6A6B5 !important; }
</style>
</head>
<body class="cf-canvas" style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${CANVAS};opacity:0;">${escapeHtml(c.preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="cf-canvas" style="background:${CANVAS};">
<tr><td align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
<tr><td class="cf-pad" style="padding:0 40px 20px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
<td style="padding-right:10px;vertical-align:middle;"><a href="${safeHref(site)}" target="_blank"><img src="${safeHref(logo)}" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border-radius:8px;"></a></td>
<td style="vertical-align:middle;"><a href="${safeHref(site)}" target="_blank" class="cf-word" style="font-family:${FONT};font-size:24px;line-height:28px;font-weight:800;letter-spacing:-0.04em;color:${INK};text-decoration:none;">clayform</a></td>
</tr></table>
</td></tr>
<tr><td>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#FFFFFF" class="cf-card" style="border-collapse:separate;background:#FFFFFF;border:1px solid ${LINE};border-radius:16px;"><tr><td class="cf-pad" style="padding:36px 40px 24px;">
<h1 class="cf-text" style="margin:0 0 20px;font-family:${FONT};font-size:26px;line-height:32px;font-weight:800;letter-spacing:-0.02em;color:${INK};">${escapeHtml(c.heading)}</h1>
${body}
</td></tr></table>
</td></tr>
<tr><td class="cf-pad" style="padding:24px 40px 0;">
${c.reason ? `<p class="cf-muted" style="margin:0 0 10px;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">${escapeHtml(c.reason)}</p>` : ""}
<p class="cf-muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">Clayform, an OPENCTRL Original &middot; <a href="${safeHref(site)}" target="_blank" class="cf-muted" style="color:${MUTED};text-decoration:underline;">Open Clayform</a> &middot; <a href="${safeHref(source)}" target="_blank" class="cf-muted" style="color:${MUTED};text-decoration:underline;">Source code</a></p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  const text = [
    c.heading,
    ...c.blocks.map(blockText),
    "--",
    ...(c.reason ? [c.reason] : []),
    `Clayform, an OPENCTRL Original\nOpen Clayform: ${site}\nSource code: ${source}`,
  ].join("\n\n");

  return { subject: c.subject, html, text };
}
