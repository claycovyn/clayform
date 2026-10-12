// /source: where this install's source code lives. The AGPL asks anyone running a modified Clayform for other people
// to offer them the source; set CLAYFORM_SOURCE_URL to your fork and this link (and the home page's) points there.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.redirect(process.env.CLAYFORM_SOURCE_URL || "https://github.com/claycovyn/clayform", 302);
}
