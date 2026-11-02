import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncToGoogleSheets } from "@/lib/sheets/mirror";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST: force a rewrite of the Google Sheets mirror. Any signed-in officer or admin may trigger it. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || profile.role === "viewer") {
    return NextResponse.json({ error: "Officers and admins only" }, { status: 403 });
  }

  try {
    const result = await syncToGoogleSheets();
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "Sync failed" }, { status: 500 });
  }
}
