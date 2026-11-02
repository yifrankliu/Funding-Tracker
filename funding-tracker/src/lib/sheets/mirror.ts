import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MasterAllocation } from "@/lib/types";
import { buildPivot } from "@/lib/pivot";

const MASTER_TAB = "Master";
const DETAIL_TAB = "Allocations";

export function sheetsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

function sheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function ensureTabs(sheets: ReturnType<typeof sheetsClient>, spreadsheetId: string, titles: string[]) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const existing = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title ?? ""));
  const missing = titles.filter((t) => !existing.has(t));
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
    });
  }
}

/**
 * Rewrites the "Master" (clubs × sources, per academic year) and "Allocations" (long form) tabs
 * from the database. Full rewrite every time: simple, and it can never drift from the DB.
 */
export async function syncToGoogleSheets(): Promise<{ ok: boolean; message: string }> {
  if (!sheetsConfigured()) return { ok: false, message: "Google Sheets mirror not configured" };
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("master_allocations")
    .select("*")
    .order("academic_year", { ascending: false })
    .order("club_name");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as MasterAllocation[];

  // ---- Master tab ----
  const years = [...new Set(rows.map((r) => r.academic_year))].sort().reverse();
  const masterValues: (string | number)[][] = [];
  for (const year of years) {
    const pivot = buildPivot(rows.filter((r) => r.academic_year === year));
    masterValues.push([`Academic year ${year}`]);
    masterValues.push(["Club", ...pivot.sources.map((s) => s.short_name || s.name), "Total"]);
    for (const c of pivot.clubs) {
      masterValues.push([c.club_name, ...pivot.sources.map((s) => c.by_source[s.id] ?? 0), c.total]);
    }
    masterValues.push(["Total", ...pivot.sources.map((s) => pivot.source_totals[s.id] ?? 0), pivot.grand_total]);
    masterValues.push([]);
  }
  masterValues.push([`Last synced ${new Date().toISOString()} — this sheet is generated; edit data in the app, not here.`]);

  // ---- Allocations tab ----
  const detailValues: (string | number)[][] = [
    ["Academic year", "Period", "Club", "Source", "Amount", "Purpose", "Uploaded at"],
    ...rows.map((r) => [r.academic_year, r.period, r.club_name, r.source_name, Number(r.amount), r.purpose ?? "", r.uploaded_at]),
  ];

  const sheets = sheetsClient();
  await ensureTabs(sheets, spreadsheetId, [MASTER_TAB, DETAIL_TAB]);
  await sheets.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges: [MASTER_TAB, DETAIL_TAB] } });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `${MASTER_TAB}!A1`, values: masterValues },
        { range: `${DETAIL_TAB}!A1`, values: detailValues },
      ],
    },
  });

  return { ok: true, message: `Synced ${rows.length} allocations to Google Sheets` };
}
