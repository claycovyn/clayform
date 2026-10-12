import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <LogoMark size={56} spin />
      <h1 className="font-display text-3xl font-extrabold">Nothing here.</h1>
      <p className="text-ink-soft">This link doesn&apos;t point to a form. It may have been moved or deleted.</p>
      <Link href="/" className="btn-outline">Go home</Link>
    </main>
  );
}
