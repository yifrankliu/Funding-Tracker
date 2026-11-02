import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/pivot";
import { DownloadLink } from "./DownloadLink";
import { DeleteUploadButton } from "./DeleteUploadButton";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  academic_year: string;
  period: string;
  file_name: string | null;
  storage_path: string | null;
  row_count: number;
  total_amount: number;
  status: "accepted" | "superseded";
  created_at: string;
  source_id: string;
  funding_sources: { name: string; short_name: string | null } | null;
  profiles: { email: string; full_name: string | null } | null;
}

export default async function UploadsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("uploads")
    .select("id, source_id, academic_year, period, file_name, storage_path, row_count, total_amount, status, created_at, funding_sources(name, short_name), profiles(email, full_name)")
    .order("created_at", { ascending: false })
    .limit(500);
  const uploads = (data ?? []) as unknown as Row[];

  // Which sources may this person delete for? Admins: all. Officers: their assigned sources.
  let deletable = new Set<string>();
  if (profile.role === "admin") {
    deletable = new Set(uploads.map((u) => u.source_id));
  } else if (profile.role === "officer") {
    const { data: os } = await supabase.from("officer_sources").select("source_id").eq("profile_id", profile.id);
    deletable = new Set((os ?? []).map((r) => r.source_id as string));
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Upload history</h1>
      <p className="mt-1 text-sm text-slate-600">Every file ever uploaded. Superseded uploads are kept for the audit trail but no longer count toward totals. Deleting an upload removes its allocations and restores the upload it replaced, if any.</p>
      <div className="card mt-6 overflow-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Source</th>
              <th>Year · period</th>
              <th>By</th>
              <th className="text-right">Rows</th>
              <th className="text-right">Total</th>
              <th>Status</th>
              <th>File</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {uploads.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-slate-500">No uploads yet.</td>
              </tr>
            )}
            {uploads.map((u) => (
              <tr key={u.id} className={u.status === "superseded" ? "text-slate-400" : ""}>
                <td className="whitespace-nowrap">{new Date(u.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
                <td>{u.funding_sources?.short_name ?? u.funding_sources?.name}</td>
                <td>{u.academic_year} · {u.period}</td>
                <td>{u.profiles?.full_name ?? u.profiles?.email}</td>
                <td className="text-right tabular-nums">{u.row_count}</td>
                <td className="text-right tabular-nums">{formatMoney(Number(u.total_amount))}</td>
                <td>
                  <span className={`badge ${u.status === "accepted" ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"}`}>{u.status}</span>
                </td>
                <td>{u.storage_path ? <DownloadLink path={u.storage_path} name={u.file_name ?? "file"} /> : <span className="text-slate-400">{u.file_name}</span>}</td>
                <td className="text-right">
                  {deletable.has(u.source_id) && (
                    <DeleteUploadButton uploadId={u.id} label={`${u.funding_sources?.short_name ?? u.funding_sources?.name} · ${u.academic_year} · ${u.period}`} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
