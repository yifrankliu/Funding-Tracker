import Anthropic from "@anthropic-ai/sdk";
import type { ColumnMapping } from "@/lib/types";
import { parseAmount } from "./normalize";

export interface MappingProposal {
  mapping: ColumnMapping;
  source: "ai" | "heuristic";
  warnings: string[];
  notes: string | null;
}

const KEYWORDS: Record<keyof ColumnMapping, RegExp[]> = {
  club_name: [/\bclub\b/i, /\borg(anization|anisation)?\b/i, /\bgroup\b/i, /\bapplicant\b/i, /\bname\b/i, /\bsociety\b/i, /\bteam\b/i],
  amount: [/\bawarded?\b/i, /\ballocat/i, /\bapproved\b/i, /\bgrant(ed)?\b/i, /\bfund(ing|ed)?\b/i, /\bamount\b/i, /\btotal\b/i, /\$|usd/i],
  purpose: [/\bpurpose\b/i, /\bevent\b/i, /\bdescription\b/i, /\bitem\b/i, /\bnotes?\b/i, /\bproject\b/i, /\bdetail/i],
  period: [/\bround\b/i, /\bsemester\b/i, /\bterm\b/i, /\bperiod\b/i, /\bcycle\b/i, /\bdate\b/i],
};

function numericRatio(rows: string[][], col: number): number {
  const sample = rows.slice(0, 50);
  if (!sample.length) return 0;
  const n = sample.filter((r) => parseAmount(r[col]) !== null && r[col] !== "").length;
  return n / sample.length;
}

function textRatio(rows: string[][], col: number): number {
  const sample = rows.slice(0, 50);
  if (!sample.length) return 0;
  const n = sample.filter((r) => r[col] && /[a-z]{3,}/i.test(r[col])).length;
  return n / sample.length;
}

/** Keyword + data-shape heuristic. Used when no API key is set, or as the fallback. */
export function heuristicMapping(headers: string[], rows: string[][]): MappingProposal {
  const mapping: ColumnMapping = { club_name: null, amount: null, purpose: null, period: null };
  const taken = new Set<number>();
  const warnings: string[] = [];

  const scoreFor = (field: keyof ColumnMapping, i: number): number => {
    let s = 0;
    for (const re of KEYWORDS[field]) if (re.test(headers[i])) s += 2;
    if (field === "amount") s += numericRatio(rows, i) * 3;
    if (field === "club_name") s += textRatio(rows, i) * 2 - numericRatio(rows, i) * 2;
    if (field === "purpose") s += textRatio(rows, i);
    return s;
  };

  // Amount first (most distinctive), then club name, then the optional fields.
  for (const field of ["amount", "club_name", "purpose", "period"] as (keyof ColumnMapping)[]) {
    let best = -1;
    let bestScore = 1.5;
    for (let i = 0; i < headers.length; i++) {
      if (taken.has(i)) continue;
      const s = scoreFor(field, i);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best >= 0) {
      mapping[field] = best;
      taken.add(best);
    }
  }

  if (mapping.club_name === null) warnings.push("Could not identify the club-name column — please pick it.");
  if (mapping.amount === null) warnings.push("Could not identify the amount column — please pick it.");
  if (mapping.amount !== null && numericRatio(rows, mapping.amount) < 0.8) {
    warnings.push("Some values in the amount column are not numbers; those rows will be flagged.");
  }
  return { mapping, source: "heuristic", warnings, notes: null };
}

const MAPPING_TOOL: Anthropic.Tool = {
  name: "propose_mapping",
  description: "Report which spreadsheet column holds each target field.",
  input_schema: {
    type: "object",
    properties: {
      club_name: { type: ["integer", "null"], description: "Zero-based index of the column with the student club / organization name." },
      amount: { type: ["integer", "null"], description: "Zero-based index of the column with the money actually awarded/allocated to the club (prefer awarded over requested)." },
      purpose: { type: ["integer", "null"], description: "Zero-based index of a column describing what the money is for (event, item, purpose), or null." },
      period: { type: ["integer", "null"], description: "Zero-based index of a column holding the funding round/semester/period, or null if the whole sheet is one period." },
      warnings: { type: "array", items: { type: "string" }, description: "Short, user-facing cautions: totals rows, merged header cells, requested-vs-awarded ambiguity, currency formatting, blank club names, etc." },
      notes: { type: "string", description: "One sentence explaining the choice." },
    },
    required: ["club_name", "amount", "purpose", "period", "warnings", "notes"],
  },
};

/** Ask Claude to map columns. Falls back to the heuristic if no key / any error. */
export async function proposeMapping(headers: string[], rows: string[][]): Promise<MappingProposal> {
  const fallback = heuristicMapping(headers, rows);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback;

  try {
    const client = new Anthropic({ apiKey });
    const sample = rows.slice(0, 8);
    const table = [headers, ...sample]
      .map((r, i) => `${i === 0 ? "HEADER" : `row ${i}`}: ` + r.map((c, j) => `[${j}] ${JSON.stringify(c)}`).join("  "))
      .join("\n");

    const res = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: 600,
      tools: [MAPPING_TOOL],
      tool_choice: { type: "tool", name: "propose_mapping" },
      messages: [
        {
          role: "user",
          content:
            "A university funding body uploaded this spreadsheet of money given to student clubs. " +
            "Columns are shown with zero-based indices in brackets. Decide which column holds the club name, " +
            "the amount actually awarded (not requested, if both exist), an optional purpose/description, and an optional " +
            "funding period. Flag anything a reviewer should double-check.\n\n" +
            `Total data rows: ${rows.length}\n\n${table}`,
        },
      ],
    });

    const toolUse = res.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return fallback;
    const out = toolUse.input as Partial<ColumnMapping> & { warnings?: string[]; notes?: string };

    const idx = (v: unknown): number | null =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 && v < headers.length ? v : null;

    const mapping: ColumnMapping = {
      club_name: idx(out.club_name),
      amount: idx(out.amount),
      purpose: idx(out.purpose),
      period: idx(out.period),
    };
    // If the model missed a required field, borrow the heuristic's guess.
    if (mapping.club_name === null) mapping.club_name = fallback.mapping.club_name;
    if (mapping.amount === null) mapping.amount = fallback.mapping.amount;

    return {
      mapping,
      source: "ai",
      warnings: Array.isArray(out.warnings) ? out.warnings.filter((w) => typeof w === "string").slice(0, 8) : [],
      notes: typeof out.notes === "string" ? out.notes : null,
    };
  } catch (err) {
    console.error("Claude mapping failed, using heuristic:", err);
    return { ...fallback, warnings: ["AI mapping unavailable; used keyword matching instead.", ...fallback.warnings] };
  }
}
