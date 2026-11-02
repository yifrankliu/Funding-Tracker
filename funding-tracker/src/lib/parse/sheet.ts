import * as XLSX from "xlsx";

export interface RawSheet {
  sheet_name: string;
  sheet_names: string[];
  header_row_index: number;
  headers: string[];
  rows: string[][];
  /** 1-based spreadsheet row number of each entry in rows (for display). */
  row_numbers: number[];
  warnings: string[];
}

const MAX_HEADER_SCAN = 30;

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return String(v).trim();
}

function isEmptyRow(r: string[]): boolean {
  return r.every((c) => c === "");
}

/**
 * Pick the header row: the first row (within the top 30) that has the most non-empty
 * text cells AND is followed by at least one row with a numeric-looking cell.
 * Handles sheets that start with a title block or blank lines.
 */
function detectHeaderRow(grid: string[][]): number {
  let bestIdx = 0;
  let bestScore = -1;
  const limit = Math.min(grid.length, MAX_HEADER_SCAN);
  for (let i = 0; i < limit; i++) {
    const row = grid[i];
    const nonEmpty = row.filter((c) => c !== "");
    if (nonEmpty.length < 2) continue;
    const textCells = nonEmpty.filter((c) => !/^[\s$€£,.\d()-]+$/.test(c)).length;
    const distinct = new Set(nonEmpty.map((c) => c.toLowerCase())).size;
    // Rows below must contain data.
    const below = grid.slice(i + 1, i + 6).filter((r) => !isEmptyRow(r));
    if (below.length === 0) continue;
    const belowHasNumbers = below.some((r) => r.some((c) => /\d/.test(c)));
    const score = textCells * 2 + distinct + (belowHasNumbers ? 3 : 0) - i * 0.1;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Choose the sheet with the most non-empty rows unless one is explicitly requested. */
function chooseSheet(wb: XLSX.WorkBook, requested?: string): string {
  if (requested && wb.SheetNames.includes(requested)) return requested;
  let best = wb.SheetNames[0];
  let bestCount = -1;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const ref = ws["!ref"];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const count = range.e.r - range.s.r + 1;
    if (count > bestCount) {
      bestCount = count;
      best = name;
    }
  }
  return best;
}

export function parseWorkbook(buffer: ArrayBuffer | Buffer, requestedSheet?: string): RawSheet {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });
  if (!wb.SheetNames.length) throw new Error("The file contains no sheets");
  const sheetName = chooseSheet(wb, requestedSheet);
  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: true, raw: true });
  const grid: string[][] = matrix.map((r) => (Array.isArray(r) ? r.map(cellToString) : []));

  const warnings: string[] = [];
  if (wb.SheetNames.length > 1) {
    warnings.push(`Workbook has ${wb.SheetNames.length} sheets; using "${sheetName}". Switch sheets above if that is wrong.`);
  }
  if (!grid.length) throw new Error(`Sheet "${sheetName}" is empty`);

  const headerIdx = detectHeaderRow(grid);
  if (headerIdx > 0) warnings.push(`Header detected on row ${headerIdx + 1}; ${headerIdx} row(s) above it were skipped.`);

  const width = Math.max(...grid.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => grid[headerIdx][i] || `Column ${XLSX.utils.encode_col(i)}`);
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  grid.slice(headerIdx + 1).forEach((r, i) => {
    const full = Array.from({ length: width }, (_, j) => r[j] ?? "");
    if (isEmptyRow(full)) return;
    rows.push(full);
    rowNumbers.push(headerIdx + 1 + i + 1); // 1-based
  });

  if (!rows.length) warnings.push("No data rows found below the header.");

  return { sheet_name: sheetName, sheet_names: wb.SheetNames, header_row_index: headerIdx, headers, rows, row_numbers: rowNumbers, warnings };
}
