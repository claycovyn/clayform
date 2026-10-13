import { oidcCallback } from "@/lib/oidcRoutes";

export const dynamic = "force-dynamic";

/** Google sends the browser back here (the redirect URI registered on the Google OAuth client). */
export const GET = (req: Request) => oidcCallback(req, "google");
