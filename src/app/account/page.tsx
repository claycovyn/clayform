import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { headers } from "next/headers";
import { AccountSettings } from "@/components/dashboard/AccountSettings";
import { ApiKeys } from "@/components/dashboard/ApiKeys";
import { DEFAULT_SCOPES, SCOPES } from "@/lib/apiKeys";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div className="min-h-screen">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Link href="/forms" className="flex items-center gap-2 text-sm font-semibold text-ink-soft hover:text-ink">
            <LogoMark size={28} />← Your forms
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="font-display text-3xl font-extrabold">Your account</h1>
        <p className="mt-1 text-ink-soft">
          {user.email} · member since {new Date(user.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </p>
        <div className="mt-8">
          <ApiKeys scopes={SCOPES} defaults={DEFAULT_SCOPES} mcpUrl={`${await origin()}/api/mcp`} />
        </div>
        <AccountSettings name={user.name} />
      </main>
    </div>
  );
}

/** This install's public address, for the MCP URL people paste into their agent. */
async function origin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
