import { oidcStart } from "@/lib/oidcRoutes";

export const dynamic = "force-dynamic";

/** "Continue with Google": remembers this attempt in a signed cookie and sends the browser to Google. */
export const GET = (req: Request) => oidcStart(req, "google");
