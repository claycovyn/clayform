// "Continue with OpenCtrl" above the email form, with the result of the last attempt (from ?openctrl=).
const MESSAGES: Record<string, string> = {
  link: "You already have a Clayform account with this email. Log in with its password once to connect it to OpenCtrl.",
  cancelled: "Sign-in with OpenCtrl was cancelled.",
  expired: "That sign-in took too long or started somewhere else. Try again.",
  taken: "That OpenCtrl account is already connected to a different Clayform account.",
  noemail: "OpenCtrl didn't share an email address, so we couldn't set up your account.",
  closed: "Sign-ups are closed on this site.",
  busy: "Too many tries. Wait a minute and try again.",
  off: "Sign-in with OpenCtrl isn't set up on this site.",
  failed: "Couldn't sign you in with OpenCtrl. Try again, or use your email and password.",
};

export function OpenctrlButton({ result }: { result?: string }) {
  const message = result ? MESSAGES[result] : undefined;
  return (
    <div className="space-y-4">
      {message && (
        <p className={`rounded-lg px-3 py-2 text-sm ${result === "link" ? "bg-brand/10 text-ink" : "bg-red-50 text-red-700"}`} role={result === "link" ? "status" : "alert"}>
          {message}
        </p>
      )}
      {result !== "link" && (
        <>
          <a href="/api/auth/openctrl/start" className="btn-outline w-full py-3 text-base">
            Continue with OpenCtrl
          </a>
          <div className="flex items-center gap-3 text-xs text-ink-soft">
            <span className="h-px flex-1 bg-ink/10" />
            or with email
            <span className="h-px flex-1 bg-ink/10" />
          </div>
        </>
      )}
    </div>
  );
}
