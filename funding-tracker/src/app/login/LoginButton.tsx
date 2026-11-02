"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LoginButton({ next, domain }: { next: string; domain: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${site}/auth/callback?next=${encodeURIComponent(next)}`,
        // Pre-selects the university Google Workspace; the server re-checks the domain anyway.
        queryParams: { hd: domain, prompt: "select_account" },
      },
    });
    if (error) {
      setErr(error.message);
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={signIn} disabled={busy} className="btn-primary w-full justify-center">
        {busy ? "Redirecting…" : "Continue with Google"}
      </button>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
    </div>
  );
}
