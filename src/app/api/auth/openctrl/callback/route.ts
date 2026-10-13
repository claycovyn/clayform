import { oidcCallback } from "@/lib/oidcRoutes";

export const dynamic = "force-dynamic";

/** OpenCtrl sends the browser back here (the redirect URI registered on OpenCtrl). */
export const GET = (req: Request) => oidcCallback(req, "openctrl");
