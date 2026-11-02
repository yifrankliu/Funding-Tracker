export type AppRole = "admin" | "officer" | "viewer";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
}

export interface FundingSource {
  id: string;
  name: string;
  short_name: string | null;
}

export interface Club {
  id: string;
  name: string;
}

export interface ClubAlias {
  alias: string;
  display: string;
  club_id: string;
}

export interface UploadRecord {
  id: string;
  source_id: string;
  uploaded_by: string | null;
  academic_year: string;
  period: string;
  file_name: string | null;
  storage_path: string | null;
  row_count: number;
  total_amount: number;
  status: "accepted" | "superseded";
  created_at: string;
}

export interface MasterAllocation {
  id: string;
  club_id: string;
  club_name: string;
  source_id: string;
  source_name: string;
  source_short_name: string | null;
  academic_year: string;
  period: string;
  amount: number;
  purpose: string | null;
  upload_id: string;
  uploaded_at: string;
}

/** Target fields every incoming spreadsheet gets mapped onto. */
export type TargetField = "club_name" | "amount" | "purpose" | "period";

/** Column mapping: target field -> zero-based column index in the parsed sheet (or null). */
export interface ColumnMapping {
  club_name: number | null;
  amount: number | null;
  purpose: number | null;
  period: number | null;
}

export interface ParsedSheet {
  sheet_name: string;
  sheet_names: string[];
  header_row_index: number;
  headers: string[];
  /** Data rows (below the header), as string cells. Empty rows removed. */
  rows: string[][];
  /** 1-based spreadsheet row number for each row (for display). */
  row_numbers: number[];
  mapping: ColumnMapping;
  mapping_source: "ai" | "heuristic" | "saved";
  warnings: string[];
  notes: string | null;
}

/** One row after the user has reviewed it. */
export interface ReviewedRow {
  club_id: string | null;
  club_name: string;
  amount: number;
  purpose: string | null;
  raw: Record<string, string>;
}
