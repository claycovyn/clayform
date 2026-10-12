import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { AccountSettings } from "@/components/dashboard/AccountSettings";
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
        <AccountSettings name={user.name} />
      </main>
    </div>
  );
}
