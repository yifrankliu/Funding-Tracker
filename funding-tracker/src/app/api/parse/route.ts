import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseWorkbook } from "@/lib/parse/sheet";
import { proposeMapping } from "@/lib/parse/mapping";
import type { ColumnMapping, ParsedSheet } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * POST multipart/form-data: file, source_id, [sheet]
 * Returns the parsed sheet plus a proposed column mapping.
 * Mapping priority: a saved mapping from this source's last upload with identical headers,
 * then Claude, then keyword heuristics.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const sourceId = String(form.get("source_id") ?? "");
  const requestedSheet = form.get("sheet") ? String(form.get("sheet")) : undefined;

  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File larger than 15 MB" }, { status: 413 });
  if (!/\.(xlsx|xlsm|xls|csv|tsv|ods)$/i.test(file.name)) {
    return NextResponse.json({ error: "Please upload an Excel, CSV or ODS file" }, { status: 400 });
  }

  let raw;
  try {
    raw = parseWorkbook(Buffer.from(await file.arrayBuffer()), requestedSheet);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read the file" }, { status: 400 });
  }

  // 1. Reuse the mapping from this source's last upload if the headers are identical.
  let saved: ColumnMapping | null = null;
  if (sourceId) {
    const { data: last } = await supabase
      .from("uploads")
      .select("mapping")
      .eq("source_id", sourceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const m = last?.mapping as (ColumnMapping & { headers?: string[] }) | null;
    if (m?.headers && JSON.stringify(m.headers) === JSON.stringify(raw.headers)) {
      saved = { club_name: m.club_name, amount: m.amount, purpose: m.purpose, period: m.period };
    }
  }

  const proposal = saved
    ? { mapping: saved, source: "saved" as const, warnings: ["Reused the column mapping from this source's previous upload (same headers)."], notes: null }
    : await proposeMapping(raw.headers, raw.rows);

  const result: ParsedSheet = {
    sheet_name: raw.sheet_name,
    sheet_names: raw.sheet_names,
    header_row_index: raw.header_row_index,
    headers: raw.headers,
    rows: raw.rows,
    row_numbers: raw.row_numbers,
    mapping: proposal.mapping,
    mapping_source: proposal.source,
    warnings: [...raw.warnings, ...proposal.warnings],
    notes: proposal.notes,
  };
  return NextResponse.json(result);
}
