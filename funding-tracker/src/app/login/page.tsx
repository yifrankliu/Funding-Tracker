import { LoginButton } from "./LoginButton";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const domain = process.env.ALLOWED_EMAIL_DOMAIN ?? "yale.edu";
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold text-[var(--yale-blue)]">Club Funding Tracker</h1>
        <p className="mt-2 text-sm text-slate-600">
          One master view of what every student club receives from every funding source on campus.
        </p>
        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <div className="mt-6">
          <LoginButton next={next ?? "/"} domain={domain} />
        </div>
        <p className="mt-4 text-xs text-slate-500">Sign in with your @{domain} Google account.</p>
      </div>
    </main>
  );
}
