import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { syncToGoogleSheets } from "@/lib/sheets/mirror";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  source_id: z.string().uuid(),
  academic_year: z.string().min(4).max(20),
  period: z.string().min(1).max(60),
  file_name: z.string().max(255).nullable(),
  storage_path: z.string().max(500).nullable(),
  mapping: z.object({
    club_name: z.number().int().nullable(),
    amount: z.number().int().nullable(),
    purpose: z.number().int().nullable(),
    period: z.number().int().nullable(),
    headers: z.array(z.string()),
  }),
  rows: z
    .array(
      z.object({
        club_id: z.string().uuid().nullable(),
        club_name: z.string().min(1).max(200),
        amount: z.number().finite(),
        purpose: z.string().max(1000).nullable(),
        raw: z.record(z.string(), z.string()),
      })
    )
    .min(1)
    .max(5000),
});

/** Atomically commits a reviewed upload via the commit_upload() SQL function, then refreshes the Sheets mirror. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;

  const { data: uploadId, error } = await supabase.rpc("commit_upload", {
    p_source_id: b.source_id,
    p_academic_year: b.academic_year.trim(),
    p_period: b.period.trim(),
    p_file_name: b.file_name,
    p_storage_path: b.storage_path,
    p_mapping: b.mapping,
    p_rows: b.rows,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  // Best effort: the DB is the source of truth; the sheet is a mirror.
  let sheets: { ok: boolean; message: string } = { ok: false, message: "Google Sheets mirror not configured" };
  try {
    sheets = await syncToGoogleSheets();
  } catch (e) {
    sheets = { ok: false, message: e instanceof Error ? e.message : "Sheets sync failed" };
  }

  return NextResponse.json({ upload_id: uploadId, sheets });
}
