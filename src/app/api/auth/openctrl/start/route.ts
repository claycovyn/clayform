import { oidcStart } from "@/lib/oidcRoutes";

export const dynamic = "force-dynamic";

/** "Continue with OpenCtrl": remembers this attempt in a signed cookie and sends the browser to OpenCtrl. */
export const GET = (req: Request) => oidcStart(req, "openctrl");
