import type { MasterAllocation } from "@/lib/types";

export interface PivotSource {
  id: string;
  name: string;
  short_name: string | null;
}

export interface PivotClub {
  club_id: string;
  club_name: string;
  by_source: Record<string, number>;
  total: number;
}

export interface Pivot {
  sources: PivotSource[];
  clubs: PivotClub[];
  source_totals: Record<string, number>;
  grand_total: number;
}

/** Clubs down the side, funding sources across the top. */
export function buildPivot(rows: MasterAllocation[]): Pivot {
  const sourceMap = new Map<string, PivotSource>();
  const clubMap = new Map<string, PivotClub>();
  const sourceTotals: Record<string, number> = {};
  let grand = 0;

  for (const r of rows) {
    const amount = Number(r.amount) || 0;
    if (!sourceMap.has(r.source_id)) {
      sourceMap.set(r.source_id, { id: r.source_id, name: r.source_name, short_name: r.source_short_name });
    }
    let club = clubMap.get(r.club_id);
    if (!club) {
      club = { club_id: r.club_id, club_name: r.club_name, by_source: {}, total: 0 };
      clubMap.set(r.club_id, club);
    }
    club.by_source[r.source_id] = round2((club.by_source[r.source_id] ?? 0) + amount);
    club.total = round2(club.total + amount);
    sourceTotals[r.source_id] = round2((sourceTotals[r.source_id] ?? 0) + amount);
    grand = round2(grand + amount);
  }

  const sources = [...sourceMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const clubs = [...clubMap.values()].sort((a, b) => a.club_name.localeCompare(b.club_name));
  return { sources, clubs, source_totals: sourceTotals, grand_total: grand };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function formatMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
