import { LogoMark } from "./Logo";

/** Shown instead of a crash when the install is missing something it needs. */
export function SetupNeeded({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card max-w-md p-6 text-center">
        <div className="flex justify-center">
          <LogoMark size={48} />
        </div>
        <h1 className="mt-4 font-display text-2xl font-extrabold">Almost there</h1>
        <p className="mt-2 text-ink-soft">{message}</p>
        <a className="btn-outline mt-5" href="https://github.com/claycovyn/clayform#deploy-on-vercel">
          Setup guide
        </a>
      </div>
    </main>
  );
}
