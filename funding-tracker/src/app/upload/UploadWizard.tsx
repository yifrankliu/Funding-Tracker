"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { ColumnMapping, FundingSource, ParsedSheet, ReviewedRow, TargetField } from "@/lib/types";
import { type KnownName, looksLikeTotalRow, normalizeName, parseAmount, suggestClubs } from "@/lib/parse/normalize";
import { formatMoney } from "@/lib/pivot";

const NEW_CLUB = "__new__";
const AUTO_MATCH_THRESHOLD = 0.85;

type Step = "setup" | "parsing" | "review" | "committing" | "done";

interface Props {
  sources: FundingSource[];
  known: KnownName[];
  seenPeriods: string[];
  seenYears: string[];
}

function defaultAcademicYear(d = new Date()): string {
  const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; // year rolls over in July
  return `${y}-${String(y + 1).slice(2)}`;
}

const FIELD_LABELS: Record<TargetField, { label: string; required: boolean; hint: string }> = {
  club_name: { label: "Club name", required: true, hint: "Which column names the student organization?" },
  amount: { label: "Amount awarded", required: true, hint: "The money actually given (not requested)." },
  purpose: { label: "Purpose / event", required: false, hint: "Optional description column." },
  period: { label: "Period column", required: false, hint: "Kept for reference only — the period you typed above is what gets recorded." },
};

interface RowView {
  index: number;
  rawName: string;
  amount: number | null;
  purpose: string | null;
  raw: Record<string, string>;
  status: "ok" | "total_row" | "no_club" | "bad_amount";
}

export function UploadWizard({ sources, known, seenPeriods, seenYears }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("setup");
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [year, setYear] = useState(seenYears[0] ?? defaultAcademicYear());
  const [period, setPeriod] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  /** rawName(normalized) -> chosen club id, or NEW_CLUB */
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState<{ id: string; row_count: number; total_amount: number } | null>(null);
  const [result, setResult] = useState<{ upload_id: string; sheets: { ok: boolean; message: string } } | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const source = sources.find((s) => s.id === sourceId);

  // Does an accepted upload already exist for this source/year/period? (It would be superseded.)
  useEffect(() => {
    if (!sourceId || !year || !period.trim()) {
      setExisting(null);
      return;
    }
    const supabase = createClient();
    let cancelled = false;
    supabase
      .from("uploads")
      .select("id, row_count, total_amount")
      .eq("source_id", sourceId)
      .eq("academic_year", year.trim())
      .eq("period", period.trim())
      .eq("status", "accepted")
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setExisting(data as typeof existing);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId, year, period]);

  const parseFile = useCallback(
    async (f: File, sheet?: string) => {
      setError(null);
      setStep("parsing");
      const fd = new FormData();
      fd.append("file", f);
      fd.append("source_id", sourceId);
      if (sheet) fd.append("sheet", sheet);
      try {
        const res = await fetch("/api/parse", { method: "POST", body: fd });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not parse the file");
        const p = body as ParsedSheet;
        setParsed(p);
        setMapping(p.mapping);
        setExcluded(new Set());
        setChoices({});
        setStep("review");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not parse the file");
        setStep("setup");
      }
    },
    [sourceId]
  );

  function onFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (!period.trim()) {
      setError("Enter the funding period (e.g. Round 4, Fall) before dropping the file.");
      return;
    }
    setFile(f);
    void parseFile(f);
  }

  // ---- derived rows -------------------------------------------------------
  const rows: RowView[] = useMemo(() => {
    if (!parsed || !mapping) return [];
    return parsed.rows.map((r, index) => {
      const raw: Record<string, string> = {};
      parsed.headers.forEach((h, i) => {
        if (r[i] !== "") raw[h] = r[i];
      });
      const rawName = mapping.club_name !== null ? r[mapping.club_name]?.trim() ?? "" : "";
      const amount = mapping.amount !== null ? parseAmount(r[mapping.amount]) : null;
      const purpose = mapping.purpose !== null ? r[mapping.purpose]?.trim() || null : null;
      let status: RowView["status"] = "ok";
      if (looksLikeTotalRow(r)) status = "total_row";
      else if (!rawName) status = "no_club";
      else if (amount === null) status = "bad_amount";
      return { index, rawName, amount, purpose, raw, status };
    });
  }, [parsed, mapping]);

  /** Unique club names needing a decision, with suggestions. */
  const nameGroups = useMemo(() => {
    const groups = new Map<string, { display: string; count: number; total: number; exact: KnownName | null; suggestions: ReturnType<typeof suggestClubs> }>();
    for (const r of rows) {
      if (r.status !== "ok" || excluded.has(r.index)) continue;
      const key = normalizeName(r.rawName);
      let g = groups.get(key);
      if (!g) {
        const exact = known.find((k) => k.text === key) ?? null;
        g = { display: r.rawName, count: 0, total: 0, exact, suggestions: exact ? [] : suggestClubs(r.rawName, known) };
        groups.set(key, g);
      }
      g.count++;
      g.total += r.amount ?? 0;
    }
    return groups;
  }, [rows, excluded, known]);

  /** Effective choice for a name: explicit > exact alias > confident suggestion > new club. */
  function choiceFor(key: string): string {
    if (choices[key]) return choices[key];
    const g = nameGroups.get(key);
    if (!g) return NEW_CLUB;
    if (g.exact) return g.exact.club_id;
    if (g.suggestions[0] && g.suggestions[0].score >= AUTO_MATCH_THRESHOLD) return g.suggestions[0].club_id;
    return NEW_CLUB;
  }

  const includedRows = rows.filter((r) => r.status === "ok" && !excluded.has(r.index));
  const total = includedRows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const newClubCount = [...nameGroups.keys()].filter((k) => choiceFor(k) === NEW_CLUB).length;
  const canCommit =
    mapping?.club_name !== null && mapping?.amount !== null && includedRows.length > 0 && period.trim() && year.trim();

  // ---- commit --------------------------------------------------------------
  async function commit() {
    if (!parsed || !mapping || !file || !source) return;
    setStep("committing");
    setError(null);
    try {
      const supabase = createClient();
      // 1. Keep the original file.
      const path = `${sourceId}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("uploads").upload(path, file, { upsert: false });
      const storagePath = upErr ? null : path;

      // 2. Commit the reviewed rows.
      const reviewed: ReviewedRow[] = includedRows.map((r) => {
        const key = normalizeName(r.rawName);
        const chosen = choiceFor(key);
        return {
          club_id: chosen === NEW_CLUB ? null : chosen,
          club_name: r.rawName,
          amount: r.amount ?? 0,
          purpose: r.purpose,
          raw: r.raw,
        };
      });
      const res = await fetch("/api/uploads/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_id: sourceId,
          academic_year: year.trim(),
          period: period.trim(),
          file_name: file.name,
          storage_path: storagePath,
          mapping: { ...mapping, headers: parsed.headers },
          rows: reviewed,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Commit failed");
      setResult(body);
      setStep("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Commit failed");
      setStep("review");
    }
  }

  // ---- render ----------------------------------------------------------------
  if (step === "done" && result) {
    return (
      <div className="card mt-6">
        <div className="flex items-center gap-2 text-green-700">
          <CheckCircle2 />
          <h2 className="text-lg font-semibold">Saved</h2>
        </div>
        <p className="mt-2 text-sm text-slate-700">
          {includedRows.length} allocations totalling <b>{formatMoney(total)}</b> recorded for <b>{source?.name}</b>,{" "}
          {year} · {period}.
          {existing && " The previous upload for this period has been superseded."}
        </p>
        <p className={`mt-1 text-sm ${result.sheets.ok ? "text-slate-600" : "text-amber-700"}`}>
          Google Sheets: {result.sheets.message}
        </p>
        <div className="mt-4 flex gap-2">
          <a href="/" className="btn-primary">View master sheet</a>
          <button
            className="btn-secondary"
            onClick={() => {
              setStep("setup");
              setParsed(null);
              setFile(null);
              setResult(null);
            }}
          >
            Upload another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Step 1: context */}
      <section className="card">
        <h2 className="font-semibold">1. What is this sheet?</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Funding source</span>
            <select className="input" value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={step !== "setup"}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Academic year</span>
            <input className="input" list="years" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2026-27" />
            <datalist id="years">
              {[...new Set([defaultAcademicYear(), ...seenYears])].map((y) => (
                <option key={y} value={y} />
              ))}
            </datalist>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Period (round / semester)</span>
            <input className="input" list="periods" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="Round 4" />
            <datalist id="periods">
              {seenPeriods.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
        </div>
        {existing && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            An accepted upload already exists for {source?.short_name ?? source?.name} · {year} · {period} ({existing.row_count}{" "}
            rows, {formatMoney(Number(existing.total_amount))}). Saving this one will replace it; the old file stays in the history.
          </p>
        )}
      </section>

      {/* Step 2: file */}
      <section className="card">
        <h2 className="font-semibold">2. Drop the spreadsheet</h2>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition ${
            dragging ? "border-blue-700 bg-blue-50" : "border-slate-300 hover:border-slate-400"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xlsm,.xls,.csv,.tsv,.ods"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          {step === "parsing" ? (
            <>
              <Loader2 className="animate-spin text-blue-700" />
              <p className="mt-2 text-sm text-slate-600">Reading the sheet and working out the columns…</p>
            </>
          ) : file ? (
            <>
              <FileSpreadsheet className="text-green-700" />
              <p className="mt-2 text-sm font-medium">{file.name}</p>
              <p className="text-xs text-slate-500">Drop another file to replace it</p>
            </>
          ) : (
            <>
              <UploadCloud className="text-slate-400" />
              <p className="mt-2 text-sm text-slate-700">Drag an Excel or CSV file here, or click to choose</p>
              <p className="text-xs text-slate-500">Any layout is fine — titles, blank rows and totals are handled.</p>
            </>
          )}
        </div>
        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
      </section>

      {/* Step 3: review */}
      {parsed && mapping && (step === "review" || step === "committing") && (
        <>
          <section className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">3. Check the column mapping</h2>
              <span className="badge bg-slate-100 text-slate-600">
                {parsed.mapping_source === "ai" ? "Suggested by AI" : parsed.mapping_source === "saved" ? "Reused from last upload" : "Keyword guess"}
              </span>
            </div>
            {parsed.sheet_names.length > 1 && (
              <label className="mt-3 block text-sm">
                <span className="mb-1 block text-slate-600">Sheet</span>
                <select className="input max-w-xs" value={parsed.sheet_name} onChange={(e) => file && parseFile(file, e.target.value)}>
                  {parsed.sheet_names.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(FIELD_LABELS) as TargetField[]).map((f) => (
                <label key={f} className="text-sm">
                  <span className="mb-1 block text-slate-600">
                    {FIELD_LABELS[f].label}
                    {FIELD_LABELS[f].required && <span className="text-red-600"> *</span>}
                  </span>
                  <select
                    className={`input ${FIELD_LABELS[f].required && mapping[f] === null ? "border-red-400" : ""}`}
                    value={mapping[f] ?? ""}
                    onChange={(e) => setMapping({ ...mapping, [f]: e.target.value === "" ? null : Number(e.target.value) })}
                  >
                    <option value="">— none —</option>
                    {parsed.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-slate-500">{FIELD_LABELS[f].hint}</span>
                </label>
              ))}
            </div>
            {(parsed.notes || parsed.warnings.length > 0) && (
              <div className="mt-4 space-y-1 text-sm">
                {parsed.notes && <p className="text-slate-600">{parsed.notes}</p>}
                {parsed.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-2 text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {w}
                  </p>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="font-semibold">4. Match club names</h2>
            <p className="mt-1 text-sm text-slate-600">
              Names that match a known club are pre-filled. Pick the right club for the rest, or let a new club be created.
              {newClubCount > 0 && (
                <>
                  {" "}
                  <b>{newClubCount}</b> new club{newClubCount === 1 ? "" : "s"} will be created.
                </>
              )}
            </p>
            <div className="mt-3 max-h-96 overflow-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name in sheet</th>
                    <th>Rows</th>
                    <th>Amount</th>
                    <th>Record as</th>
                  </tr>
                </thead>
                <tbody>
                  {[...nameGroups.entries()].map(([key, g]) => {
                    const chosen = choiceFor(key);
                    const auto = !choices[key] && !g.exact && chosen !== NEW_CLUB;
                    return (
                      <tr key={key}>
                        <td className="font-medium">{g.display}</td>
                        <td>{g.count}</td>
                        <td>{formatMoney(g.total)}</td>
                        <td>
                          {g.exact ? (
                            <span className="text-green-700">{g.exact.club_name}</span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                className={`input max-w-xs ${auto ? "border-amber-400" : ""}`}
                                value={chosen}
                                onChange={(e) => setChoices({ ...choices, [key]: e.target.value })}
                              >
                                <option value={NEW_CLUB}>＋ Create new club “{g.display}”</option>
                                {g.suggestions.length > 0 && (
                                  <optgroup label="Suggested">
                                    {g.suggestions.map((s) => (
                                      <option key={s.club_id} value={s.club_id}>
                                        {s.club_name} ({Math.round(s.score * 100)}%)
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                <optgroup label="All clubs">
                                  {[...new Map(known.map((k) => [k.club_id, k.club_name])).entries()]
                                    .sort((a, b) => a[1].localeCompare(b[1]))
                                    .map(([id, name]) => (
                                      <option key={id} value={id}>
                                        {name}
                                      </option>
                                    ))}
                                </optgroup>
                              </select>
                              {auto && <span className="badge bg-amber-50 text-amber-800">auto-matched, please confirm</span>}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2 className="font-semibold">5. Review rows</h2>
            <p className="mt-1 text-sm text-slate-600">
              Greyed-out rows are skipped (totals, blanks, or amounts we could not read). Untick anything else you do not want saved.
            </p>
            <div className="mt-3 max-h-[28rem] overflow-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th></th>
                    <th>#</th>
                    <th>Club</th>
                    <th>Amount</th>
                    <th>Purpose</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const skipped = r.status !== "ok";
                    const off = skipped || excluded.has(r.index);
                    return (
                      <tr key={r.index} className={off ? "text-slate-400" : ""}>
                        <td>
                          <input
                            type="checkbox"
                            disabled={skipped}
                            checked={!off}
                            onChange={(e) => {
                              const next = new Set(excluded);
                              if (e.target.checked) next.delete(r.index);
                              else next.add(r.index);
                              setExcluded(next);
                            }}
                          />
                        </td>
                        <td>{parsed.row_numbers[r.index]}</td>
                        <td>{r.rawName || <i>blank</i>}</td>
                        <td className="tabular-nums">{r.amount !== null ? formatMoney(r.amount) : <i>{mapping.amount !== null ? parsed.rows[r.index][mapping.amount] || "blank" : ""}</i>}</td>
                        <td className="max-w-xs truncate">{r.purpose}</td>
                        <td>
                          {r.status === "ok" && <span className="badge bg-green-50 text-green-700">ok</span>}
                          {r.status === "total_row" && <span className="badge bg-slate-100 text-slate-500">totals row</span>}
                          {r.status === "no_club" && <span className="badge bg-slate-100 text-slate-500">no club</span>}
                          {r.status === "bad_amount" && <span className="badge bg-red-50 text-red-700">unreadable amount</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm">
              <div>
                <b>{includedRows.length}</b> allocations · <b>{formatMoney(total)}</b> · {source?.name} · {year} · {period || "—"}
              </div>
              {existing && <div className="text-amber-800">Replaces the existing upload for this period.</div>}
            </div>
            <button className="btn-primary" disabled={!canCommit || step === "committing"} onClick={commit}>
              {step === "committing" ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Saving…
                </>
              ) : (
                "Save to master sheet"
              )}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
