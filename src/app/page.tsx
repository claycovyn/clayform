import Link from "next/link";
import { Logo, LogoMark } from "@/components/Logo";
import { Player } from "@/components/player/Player";
import { blankForm, choice, newField, THEME_PRESETS, uid } from "@/lib/fields";
import type { Form } from "@/lib/types";

const REPO = "https://github.com/claycovyn/clayform";

function demoForm(): Form {
  const form = blankForm("Try it — this is a real Clayform");
  form.theme = { ...THEME_PRESETS[0], radius: 14 };
  form.welcome = {
    enabled: true,
    title: "Hey there 👋",
    description: "This is a live Clayform. Three quick questions — use your keyboard if you like.",
    buttonLabel: "Let's go",
  };
  form.fields = [
    { ...newField("short_text"), ref: "name", title: "What should we call you?", required: true, placeholder: "Your first name" },
    {
      ...newField("multiple_choice"),
      ref: "use",
      title: "Nice to meet you, {{name}}. What are you building?",
      required: true,
      allowOther: true,
      choices: [choice("Customer feedback"), choice("Lead capture"), choice("A quiz"), choice("Event sign-ups")],
    },
    { ...newField("rating"), ref: "paid", title: "How tired are you of paying per response?", steps: 5 },
  ];
  form.endings = [{ id: uid(6), title: "That's the feeling, {{name}}.", description: "Now imagine it free, on your own server, with no response limits. That's Clayform." }];
  form.settings.showQuestionNumbers = true;
  return form;
}

const FEATURES: [string, string][] = [
  ["No response limits", "Your server, your database. A form never stops collecting because you hit a monthly cap."],
  ["Everything unlocked", "Logic jumps, scoring, hidden fields, file uploads, webhooks, custom endings. No tiers."],
  ["Partial responses", "Answers save as people go. See exactly where they stop, and let them finish later — even on another device."],
  ["Two layouts", "One question at a time for completion, or a classic one-page form when speed matters. Switch anytime."],
  ["Works offline", "Lost signal on the last question? Answers wait on the device and send when the connection's back."],
  ["Real analytics", "Drop-off per question, NPS calculated for you, completion rate, average time, endings reached."],
  ["Clean exports", "CSV that opens right in Excel (and can't inject formulas), JSON, or a signed webhook on every response."],
  ["Forms as code", "Every form is plain JSON. Back it up, review it in Git, move it between installs. Zero lock-in."],
  ["Accessible by default", "Full keyboard control, screen-reader labels, contrast warnings in the designer, reduced-motion support."],
  ["Undo everything", "Ctrl/⌘ Z in the builder. Bulk-paste options. Duplicate questions. Edit like a normal app."],
  ["Your brand only", "The “Made with” badge is off by default. Custom themes, fonts, background images, your own domain."],
  ["Private by design", "No tracking scripts, no third-party analytics. Uploaded files are only downloadable by you."],
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Logo size={32} spin />
        <nav className="flex items-center gap-2">
          <a href={REPO} className="btn-ghost hidden sm:inline-flex">
            GitHub
          </a>
          <Link href="/forms" className="btn-primary">
            Open dashboard
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand-dark">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" /> Free forever · MIT licensed · Self-hosted
            </p>
            <h1 className="mt-5 font-display text-5xl font-extrabold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
              Forms people <span className="text-brand">actually finish.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-soft">
              Clayform is a beautiful, conversational form builder you own. One question at a time, logic, scoring, file uploads and real analytics — with no
              response caps, no paywalled features and no monthly bill.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/forms" className="btn-brand px-6 py-3 text-base">
                Build a form →
              </Link>
              <a href={REPO} className="btn-outline px-6 py-3 text-base">
                ★ Star on GitHub
              </a>
            </div>
            <pre className="mt-8 max-w-xl overflow-x-auto rounded-xl bg-ink p-4 text-sm text-paper">
              <code>{`git clone ${REPO}\ncd clayform && npm install\nnpm run dev`}</code>
            </pre>
          </div>
          <div className="relative h-[520px] overflow-hidden rounded-3xl border border-ink/10 shadow-[0_30px_80px_-30px_rgba(27,23,20,0.35)]">
            <Player form={demoForm()} preview contained />
          </div>
        </section>

        <section className="border-y border-ink/10 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 className="max-w-2xl font-display text-4xl font-extrabold tracking-tight">Built from the complaints.</h2>
            <p className="mt-3 max-w-2xl text-ink-soft">
              We read the reviews of the big paid form builders. The same things come up again and again: price jumps, response limits that stop forms
              mid-campaign, useful features behind higher tiers, thin reporting, clunky exports. Clayform fixes each one.
            </p>
            <div className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(([title, body]) => (
                <div key={title}>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] text-white">✓</span>
                    {title}
                  </h3>
                  <p className="mt-1.5 text-sm text-ink-soft">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="grid gap-8 md:grid-cols-3">
            {[
              ["18 question types", "Text, email, phone, number, website, multiple choice, picture choice, dropdown, yes/no, ranking, rating, opinion scale, NPS, date, file upload, consent and statements."],
              ["Logic that reads like English", "“If budget is at least 10000 and plan is Pro, go to Book a call.” Branch on answers, hidden fields or score, and send people to different endings."],
              ["Embed anywhere", "Inline, popup or plain iframe, with hidden fields and a submit event for your own code. One script tag."],
            ].map(([t, b]) => (
              <div key={t} className="card p-6">
                <h3 className="font-display text-xl font-extrabold">{t}</h3>
                <p className="mt-2 text-sm text-ink-soft">{b}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-ink text-paper">
          <div className="mx-auto flex max-w-6xl flex-col items-center px-4 py-20 text-center">
            <LogoMark size={64} spin />
            <h2 className="mt-6 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Your forms. Your data. $0.</h2>
            <p className="mt-4 max-w-xl text-paper/70">Run it on a $5 server, a Raspberry Pi or your laptop. One command with Docker. Contributions welcome.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/forms" className="btn-brand px-6 py-3 text-base">
                Start building
              </Link>
              <a href={REPO} className="btn px-6 py-3 text-base text-paper ring-1 ring-paper/30 hover:bg-paper/10">
                Read the docs
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-ink-soft">
        <Logo size={22} />
        <p>Open source under the MIT license. Not affiliated with any other form company.</p>
      </footer>
    </div>
  );
}
