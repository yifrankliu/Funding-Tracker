/**
 * Must match normalize_name() in supabase/migrations/0001_init.sql:
 *   trim(regexp_replace(lower(p), '[^a-z0-9]+', ' ', 'g'))
 */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "$1,250.00", "(300)", "1 250", "USD 40" -> number; returns null when nothing numeric is present. */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? round2(raw) : null;
  let s = String(raw).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[^0-9.,]/g, "");
  if (!s) return null;
  // Decide whether comma is a thousands separator or a decimal point.
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    const parts = s.split(",");
    s = parts[parts.length - 1].length === 2 && parts.length === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return round2(negative ? -n : n);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Rows like "Total", "Grand total", "Subtotal" should never become allocations. */
export function looksLikeTotalRow(cells: string[]): boolean {
  return cells.some((c) => /^\s*(grand\s+)?(sub)?totals?\b/i.test(c));
}

// ---------------------------------------------------------------------------
// Fuzzy matching of club names against known aliases
// ---------------------------------------------------------------------------

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  const t = s.replace(/\s+/g, " ");
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice coefficient on character bigrams, 0..1. */
export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/** Token overlap, 0..1. Helps with "Yale Outdoors" vs "Outdoors Club, Yale". */
export function tokenSimilarity(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(A.size, B.size);
}

/** Acronym check: "yo" vs "yale outdoors" -> true. */
export function acronymMatches(short: string, long: string): boolean {
  const tokens = long.split(" ").filter(Boolean);
  if (tokens.length < 2) return false;
  const acronym = tokens.map((t) => t[0]).join("");
  return acronym === short.replace(/\s+/g, "");
}

export interface Candidate {
  club_id: string;
  club_name: string;
  matched_text: string;
  score: number;
}

export interface KnownName {
  club_id: string;
  club_name: string;
  text: string; // normalized alias or club name
  display: string;
}

/** Rank known clubs/aliases for a raw spreadsheet name. */
export function suggestClubs(rawName: string, known: KnownName[], limit = 3): Candidate[] {
  const q = normalizeName(rawName);
  if (!q) return [];
  const best = new Map<string, Candidate>();
  for (const k of known) {
    let score = Math.max(diceSimilarity(q, k.text), tokenSimilarity(q, k.text));
    if (acronymMatches(q, k.text) || acronymMatches(k.text, q)) score = Math.max(score, 0.9);
    if (q === k.text) score = 1;
    const prev = best.get(k.club_id);
    if (!prev || prev.score < score) {
      best.set(k.club_id, { club_id: k.club_id, club_name: k.club_name, matched_text: k.display, score });
    }
  }
  return [...best.values()]
    .filter((c) => c.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
