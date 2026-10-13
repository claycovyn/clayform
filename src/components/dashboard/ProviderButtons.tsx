import { PROVIDER_LABEL, startHref, type ProviderView } from "@/lib/signinProviders";

// Above the email form on log-in and sign-up: the result of the last attempt, then Continue with OpenCtrl, Continue
// with Google and one "or with email" divider. Renders nothing when no provider is set up and there's nothing to say.
export function ProviderButtons({ view }: { view: ProviderView }) {
  if (!view.notices.length && !view.buttons.length) return null;
  return (
    <div className="mb-4 space-y-4">
      {view.notices.map((n) => (
        <p key={n.text} className={`rounded-lg px-3 py-2 text-sm ${n.role === "status" ? "bg-brand/10 text-ink" : "bg-red-50 text-red-700"}`} role={n.role}>
          {n.text}
        </p>
      ))}
      {view.buttons.length > 0 && (
        <div className="space-y-3">
          {view.buttons.map((p) => (
            <a key={p} href={startHref(p)} className="btn-outline w-full py-3 text-base">
              {PROVIDER_LABEL[p]}
            </a>
          ))}
        </div>
      )}
      {view.divider && (
        <div className="flex items-center gap-3 text-xs text-ink-soft">
          <span className="h-px flex-1 bg-ink/10" />
          or with email
          <span className="h-px flex-1 bg-ink/10" />
        </div>
      )}
    </div>
  );
}
