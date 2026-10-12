import { redirect } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { LoginForm } from "@/components/dashboard/LoginForm";
import { authConfigured, isAdmin } from "@/lib/auth";
import { storageProblem } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await isAdmin()) redirect("/forms");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <LogoMark size={56} spin />
          <h1 className="font-display text-3xl font-extrabold">Welcome back</h1>
        </div>
        {storageProblem() ? (
          <p className="card p-5 text-sm">{storageProblem()}</p>
        ) : authConfigured() ? (
          <LoginForm />
        ) : (
          <p className="card p-5 text-sm">
            Set <code className="rounded bg-mist px-1">CLAYFORM_PASSWORD</code> in your environment (on Vercel: Settings → Environment Variables), then redeploy or restart.
          </p>
        )}
      </div>
    </main>
  );
}
