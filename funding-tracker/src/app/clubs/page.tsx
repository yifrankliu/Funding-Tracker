import Link from "next/link";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { addAlias, mergeClubs, removeAlias, renameClub } from "@/actions/clubs";
import { formatMoney } from "@/lib/pivot";
import type { Club, ClubAlias, MasterAllocation } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ClubsPage({ searchParams }: { searchParams: Promise<{ club?: string; q?: string }> }) {
  const { club: selectedId, q } = await searchParams;
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: clubsData }, { data: aliasData }, { data: allocData }] = await Promise.all([
    supabase.from("clubs").select("id, name").order("name"),
    supabase.from("club_aliases").select("alias, display, club_id"),
    supabase.from("master_allocations").select("*"),
  ]);
  const clubs = (clubsData ?? []) as Club[];
  const aliases = (aliasData ?? []) as ClubAlias[];
  const allocations = (allocData ?? []) as MasterAllocation[];

  const totals = new Map<string, number>();
  for (const a of allocations) totals.set(a.club_id, (totals.get(a.club_id) ?? 0) + Number(a.amount));

  const filter = (q ?? "").toLowerCase();
  const visible = clubs.filter((c) => !filter || c.name.toLowerCase().includes(filter) || aliases.some((a) => a.club_id === c.id && a.display.toLowerCase().includes(filter)));
  const selected = clubs.find((c) => c.id === selectedId) ?? null;
  const selectedAliases = selected ? aliases.filter((a) => a.club_id === selected.id) : [];
  const selectedAllocs = selected
    ? allocations.filter((a) => a.club_id === selected.id).sort((a, b) => b.academic_year.localeCompare(a.academic_year) || a.period.localeCompare(b.period))
    : [];
  const canEdit = profile.role !== "viewer";
  const isAdmin = profile.role === "admin";

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Clubs</h1>
      <p className="mt-1 text-sm text-slate-600">
        One row per organization. Aliases are every spelling we have seen in a spreadsheet; they are what makes “YO” and “Yale Outdoors” land on the same row.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="card p-0">
          <form className="flex gap-2 border-b border-slate-200 p-3" method="get">
            <input name="q" defaultValue={q ?? ""} placeholder="Search clubs and aliases…" className="input" />
            <button className="btn-secondary">Search</button>
          </form>
          <div className="max-h-[70vh] overflow-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Club</th>
                  <th className="text-right">Aliases</th>
                  <th className="text-right">All-time</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.id} className={c.id === selectedId ? "bg-blue-50" : "hover:bg-slate-50"}>
                    <td>
                      <Link href={`/clubs?club=${c.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="text-right text-slate-500">{aliases.filter((a) => a.club_id === c.id).length}</td>
                    <td className="text-right tabular-nums">{formatMoney(totals.get(c.id) ?? 0)}</td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-center text-slate-500">No clubs yet — they are created automatically on the first upload.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          {!selected ? (
            <div className="card text-sm text-slate-600">Select a club to see its aliases and funding history.</div>
          ) : (
            <>
              <div className="card">
                {isAdmin ? (
                  <ActionForm action={renameClub} className="flex gap-2" successText="Renamed">
                    <input type="hidden" name="club_id" value={selected.id} />
                    <input name="name" defaultValue={selected.name} className="input text-lg font-semibold" />
                    <button className="btn-secondary">Rename</button>
                  </ActionForm>
                ) : (
                  <h2 className="text-lg font-semibold">{selected.name}</h2>
                )}

                <h3 className="mt-4 text-sm font-semibold text-slate-700">Aliases</h3>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {selectedAliases.map((a) => (
                    <li key={a.alias} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm">
                      {a.display}
                      {isAdmin && (
                        <ActionForm action={removeAlias} className="inline">
                          <input type="hidden" name="alias" value={a.alias} />
                          <button className="ml-1 text-slate-400 hover:text-red-600" title="Remove alias">×</button>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                  {selectedAliases.length === 0 && <li className="text-sm text-slate-500">None yet.</li>}
                </ul>
                {canEdit && (
                  <ActionForm action={addAlias} className="mt-3 flex gap-2" successText="Alias added">
                    <input type="hidden" name="club_id" value={selected.id} />
                    <input name="alias" placeholder="Add another spelling, e.g. YO" className="input max-w-xs" />
                    <button className="btn-secondary">Add alias</button>
                  </ActionForm>
                )}

                {isAdmin && clubs.length > 1 && (
                  <div className="mt-6 border-t border-slate-200 pt-4">
                    <h3 className="text-sm font-semibold text-slate-700">Merge into another club</h3>
                    <p className="mt-1 text-xs text-slate-500">Moves every allocation and alias of “{selected.name}” into the chosen club, then deletes this one. Cannot be undone.</p>
                    <ActionForm action={mergeClubs} className="mt-2 flex gap-2">
                      <input type="hidden" name="from" value={selected.id} />
                      <select name="into" className="input max-w-xs" defaultValue="">
                        <option value="" disabled>Choose the club to keep…</option>
                        {clubs.filter((c) => c.id !== selected.id).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <button className="btn-secondary">Merge</button>
                    </ActionForm>
                  </div>
                )}
              </div>

              <div className="card p-0">
                <div className="flex items-center justify-between px-4 py-3">
                  <h3 className="text-sm font-semibold text-slate-700">Funding history</h3>
                  <span className="text-sm tabular-nums">{formatMoney(totals.get(selected.id) ?? 0)} all-time</span>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Year · period</th>
                      <th>Source</th>
                      <th className="text-right">Amount</th>
                      <th>Purpose</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedAllocs.map((a) => (
                      <tr key={a.id}>
                        <td className="whitespace-nowrap">{a.academic_year} · {a.period}</td>
                        <td>{a.source_short_name ?? a.source_name}</td>
                        <td className="text-right tabular-nums">{formatMoney(Number(a.amount))}</td>
                        <td className="max-w-xs truncate" title={a.purpose ?? ""}>{a.purpose}</td>
                      </tr>
                    ))}
                    {selectedAllocs.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center text-slate-500">No allocations recorded.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
