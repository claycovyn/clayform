import Link from "next/link";
import { Logo } from "@/components/Logo";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center px-4 py-10 sm:justify-center">
      <Link href="/" className="mb-8">
        <Logo size={32} spin />
      </Link>
      <div className="w-full max-w-sm">
        <h1 className="text-center font-display text-3xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-center text-ink-soft">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}
