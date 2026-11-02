import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** OAuth redirect target. Exchanges the code for a session and enforces the email-domain allowlist. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!code) return NextResponse.redirect(`${origin}/login?error=missing_code`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);

  const domain = (process.env.ALLOWED_EMAIL_DOMAIN ?? "").toLowerCase().trim();
  if (domain) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const email = user?.email?.toLowerCase() ?? "";
    if (!email.endsWith(`@${domain}`)) {
      await supabase.auth.signOut();
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(`Please sign in with your @${domain} account`)}`);
    }
  }
  return NextResponse.redirect(`${origin}${safeNext}`);
}
