import Link from "next/link";
import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { buildPivot, formatMoney } from "@/lib/pivot";
import type { MasterAllocation } from "@/lib/types";
import { SyncButton } from "@/components/SyncButton";
import { sheetsConfigured } from "@/lib/sheets/mirror";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; period?: string; q?: string; error?: string }>;
}) {
  const params = await searchParams;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: all } = await supabase.from("master_allocations").select("*");
  const rows = (all ?? []) as MasterAllocation[];

  const years = [...new Set(rows.map((r) => r.academic_year))].sort().reverse();
  const year = params.year && years.includes(params.year) ? params.year : years[0];
  const inYear = rows.filter((r) => r.academic_year === year);
  const periods = [...new Set(inYear.map((r) => r.period))].sort();
  const period = params.period && periods.includes(params.period) ? params.period : "";
  const q = (params.q ?? "").trim().toLowerCase();

  const filtered = inYear
    .filter((r) => !period || r.period === period)
    .filter((r) => !q || r.club_name.toLowerCase().includes(q));
  const pivot = buildPivot(filtered);

  const sheetUrl = process.env.GOOGLE_SHEET_ID ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}` : null;

  return (
    <Shell>
      {params.error && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {params.error === "admins_only" ? "That page is for admins only." : "That page is for funding officers only."}
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Master sheet</h1>
          <p className="mt-1 text-sm text-slate-600">Every club, every source, one table. Only the latest accepted upload per source and period counts.</p>
        </div>
        <div className="flex items-center gap-2">
          {sheetUrl && (
            <a href={sheetUrl} target="_blank" rel="noreferrer" className="btn-secondary">
              Open Google Sheet
            </a>
          )}
          {profile.role !== "viewer" && sheetsConfigured() && <SyncButton />}
          {profile.role !== "viewer" && (
            <Link href="/upload" className="btn-primary">
              Upload a sheet
            </Link>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card mt-6 text-sm text-slate-700">
          Nothing here yet. {profile.role !== "viewer" ? <Link className="underline" href="/upload">Upload the first spreadsheet</Link> : "Ask a funding officer to upload a spreadsheet."}
        </div>
      ) : (
        <>
          <form className="card mt-6 flex flex-wrap items-end gap-4" method="get">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Academic year</span>
              <select name="year" defaultValue={year} className="input">
                {years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Period</span>
              <select name="period" defaultValue={period} className="input">
                <option value="">All periods</option>
                {periods.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Club</span>
              <input name="q" defaultValue={params.q ?? ""} placeholder="Search…" className="input" />
            </label>
            <button className="btn-secondary">Apply</button>
          </form>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Stat label="Clubs funded" value={String(pivot.clubs.length)} />
            <Stat label="Funding sources" value={String(pivot.sources.length)} />
            <Stat label="Total allocated" value={formatMoney(pivot.grand_total)} />
          </div>

          <div className="card mt-4 overflow-auto p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>Club</th>
                  {pivot.sources.map((s) => (
                    <th key={s.id} className="text-right" title={s.name}>
                      {s.short_name || s.name}
                    </th>
                  ))}
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {pivot.clubs.map((c) => (
                  <tr key={c.club_id} className="hover:bg-slate-50">
                    <td className="font-medium">
                      <Link href={`/clubs?club=${c.club_id}`} className="hover:underline">
                        {c.club_name}
                      </Link>
                    </td>
                    {pivot.sources.map((s) => (
                      <td key={s.id} className="text-right tabular-nums">
                        {c.by_source[s.id] ? formatMoney(c.by_source[s.id]) : <span className="text-slate-300">—</span>}
                      </td>
                    ))}
                    <td className="text-right font-semibold tabular-nums">{formatMoney(c.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td>Total</td>
                  {pivot.sources.map((s) => (
                    <td key={s.id} className="text-right tabular-nums">
                      {formatMoney(pivot.source_totals[s.id] ?? 0)}
                    </td>
                  ))}
                  <td className="text-right tabular-nums">{formatMoney(pivot.grand_total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
