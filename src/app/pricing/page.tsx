import Link from "next/link";
import { Logo } from "@/components/Logo";
import { CLOUD, CLOUD_PRICE_LABEL } from "@/lib/plans";

export const metadata = { title: "Pricing", description: "Clayform is free to self-host. Hosted: start free, or get every OPENCTRL app with OPENCTRL Cloud." };

const n = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString("en-US"));

export default function Pricing() {
  const m = CLOUD.meters;
  const line = (k: string, amounts: Record<string, number>) => `${n(amounts[k])} ${m[k].unit}${m[k].unit === "GB" ? ` ${k}` : ""}${m[k].period === "month" ? " a month" : ""}`;
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Link href="/"><Logo size={28} /></Link>
        <Link href="/signup" className="btn-primary">Sign up free</Link>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-6">
        <h1 className="font-display text-5xl font-extrabold tracking-tight">The software is free.</h1>
        <p className="mt-3 max-w-2xl text-lg text-ink-soft">Every feature is in every plan. You only pay if you want us to run it for you, and even then you can export everything at any time.</p>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          <section className="card flex flex-col p-6">
            <h2 className="text-xl font-bold">Self-host</h2>
            <p className="mt-1 font-display text-4xl font-extrabold">$0<span className="text-base font-semibold text-ink-soft"> forever</span></p>
            <ul className="mt-5 space-y-2 text-sm">
              <li>Every feature, no limits</li>
              <li>Your server, your data</li>
              <li>Open source (AGPL-3.0)</li>
            </ul>
            <Link href="/source" className="btn-outline mt-auto pt-3">Get the code</Link>
          </section>
          <section className="card flex flex-col p-6">
            <h2 className="text-xl font-bold">Free Cloud</h2>
            <p className="mt-1 font-display text-4xl font-extrabold">$0</p>
            <ul className="mt-5 space-y-2 text-sm">
              {Object.keys(m).filter((k) => (CLOUD.free[k] ?? 0) > 0).map((k) => <li key={k}>{line(k, CLOUD.free)}</li>)}
              <li>Every feature</li>
              <li>At the limit, forms pause new responses. Nothing is deleted.</li>
            </ul>
            <Link href="/signup" className="btn-primary mt-auto pt-3">Start free</Link>
          </section>
          <section className="card flex flex-col border-2 border-brand p-6">
            <h2 className="text-xl font-bold">OPENCTRL Cloud</h2>
            <p className="mt-1 font-display text-4xl font-extrabold">{CLOUD_PRICE_LABEL.replace("/month", "")}<span className="text-base font-semibold text-ink-soft"> a month</span></p>
            <p className="mt-1 text-sm font-semibold text-brand-dark">Every hosted OPENCTRL app, one subscription.</p>
            <ul className="mt-5 space-y-2 text-sm">
              {Object.keys(m).map((k) => <li key={k}>Up to {line(k, CLOUD.fair_use)} in Clayform (fair use)</li>)}
              <li>Heavy use? Add a pack ({CLOUD.packs.map((p) => p.label).join(", ")}) instead of hitting a wall.</li>
              <li>Founding members keep this price for as long as they stay subscribed.</li>
            </ul>
            <span className="btn-outline mt-auto pt-3 opacity-70">Coming soon</span>
          </section>
        </div>
        <p className="mt-8 text-sm text-ink-soft">Accounts created before our hosted plans keep no response caps. Prices in USD.</p>
      </main>
    </div>
  );
}
