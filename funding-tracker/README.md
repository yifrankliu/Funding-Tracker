# Club Funding Tracker

One master view of how much every Yale student club receives from every funding source
(UOFC, cultural centers, campus initiatives). Officers drag in their own spreadsheets, in
whatever layout they keep them; the app works out the columns, matches club names, shows a
review screen, and only then writes to the shared database. A Google Sheet mirror is
regenerated after every accepted upload.

## How it works

```
spreadsheet (any layout)
   │  drag & drop
   ▼
/api/parse ── SheetJS reads the file, finds the real header row, skips titles/blank rows
   │          Claude proposes which column is club / amount / purpose (keyword fallback)
   ▼
Review screen ── officer confirms the mapping, resolves unknown club names
   │              (exact alias → auto; fuzzy suggestion → confirm; else new club)
   ▼
/api/uploads/commit ── commit_upload() SQL function, one transaction:
   │   • creates clubs + aliases as needed   • inserts allocations
   │   • supersedes the previous upload for the same source + year + period
   ▼
Postgres (source of truth) ──► Google Sheets "Master" + "Allocations" tabs (mirror)
```

Roles: **admin** (UOFC team: everything), **officer** (uploads for assigned sources),
**viewer** (read-only). The first person to sign in becomes admin.

## Stack

Next.js 15 (App Router) · Supabase (Postgres, Auth, Storage, RLS) · Tailwind 4 ·
SheetJS · Anthropic SDK (optional) · Google Sheets API (optional) · deployed on Vercel.

## Setup (about 30 minutes)

### 1. Supabase

1. Create a project at supabase.com (use a shared UOFC Google account, not a personal one).
2. SQL Editor → paste and run `supabase/migrations/0001_init.sql`.
3. Authentication → Providers → **Google**: enable it. You need a Google OAuth client:
   - Google Cloud Console → APIs & Services → Credentials → Create OAuth client (Web).
   - Authorised redirect URI: `https://<your-project>.supabase.co/auth/v1/callback`.
   - Paste the client ID and secret into Supabase.
4. Authentication → URL Configuration: set Site URL to your Vercel URL and add
   `http://localhost:3000/**` and `https://<your-app>.vercel.app/**` to Redirect URLs.
5. Project Settings → **Data API**: copy the Project URL. Project Settings → **API Keys**: copy the
   **publishable** key (→ `NEXT_PUBLIC_SUPABASE_ANON_KEY`) and create a **secret** key
   (→ `SUPABASE_SERVICE_ROLE_KEY`). The legacy anon / service_role JWTs work too.

### 2. Local run

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev                  # http://localhost:3000
```

Sign in with your @yale.edu Google account. You are now the admin: go to **Admin**, add the
funding sources, and (once colleagues have signed in once) make them officers and tick
which sources they may upload for.

### 3. Deploy to Vercel

1. Push this folder to a GitHub repo (under the shared org account).
2. vercel.com → New Project → import the repo. Framework is auto-detected.
3. Add every variable from `.env.example` under Settings → Environment Variables.
   Set `NEXT_PUBLIC_SITE_URL` to the production URL.
4. Deploy. Add the production URL to Supabase's Redirect URLs (step 1.4).

### 4. Optional: AI column mapping

Set `ANTHROPIC_API_KEY` (console.anthropic.com). Each upload sends only the header row and
eight sample rows; cost is a fraction of a cent. Without a key the app falls back to keyword
matching, which works well on sheets with sensible headers.

### 5. Optional: Google Sheets mirror

1. Google Cloud Console → enable the **Google Sheets API**.
2. IAM & Admin → Service Accounts → create one → Keys → add a JSON key.
3. Create a Google Sheet; share it with the service account's email as **Editor**.
4. Set `GOOGLE_SHEET_ID` (from the sheet URL), `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and
   `GOOGLE_PRIVATE_KEY` (the `private_key` field from the JSON, with its `\n` escapes).

The sheet is rewritten in full after each accepted upload and by the **Sync sheet** button.
Treat it as read-only: edits made in the sheet are overwritten on the next sync.

## Project layout

```
supabase/migrations/0001_init.sql   schema, RLS, commit_upload(), merge_clubs(), master view
src/middleware.ts                   session refresh + login gate
src/lib/parse/sheet.ts              SheetJS parsing, header-row detection
src/lib/parse/mapping.ts            Claude column mapping + keyword heuristic
src/lib/parse/normalize.ts          amount parsing, name normalization, fuzzy club matching
src/lib/sheets/mirror.ts            Google Sheets rewrite
src/lib/pivot.ts                    clubs × sources pivot
src/app/page.tsx                    master sheet (dashboard)
src/app/upload/                     drag-and-drop → review → save wizard
src/app/uploads/                    history with superseded uploads and file downloads
src/app/clubs/                      aliases, rename, merge
src/app/admin/                      sources, members, roles
src/app/api/parse|uploads/commit|sheets/sync
```

## Design notes

- **Postgres is the source of truth; the sheet is a mirror.** Concurrency, audit trail and
  permissions all live in the database. The sheet exists for people who want to pivot in a
  familiar tool.
- **Re-uploads supersede, never duplicate.** A second upload for the same source + academic
  year + period replaces the first; the old rows and file stay in the history.
- **Name normalization is an alias table**, not fuzzy matching at query time. Fuzzy matching
  only *suggests* during review; once confirmed, the spelling is saved so it resolves
  automatically next time.
- **The AI only proposes.** Nothing is written until an officer has looked at the mapping,
  the club matches and the row list.
- The `period` you type on upload (e.g. "Round 4") is what gets recorded; a period column in
  the sheet is kept in `raw_row` for reference.

## Roadmap ideas

- Per-club public lookup page (clubs see their own totals across sources).
- Export the master view as .xlsx from the dashboard.
- Per-source upload reminders at the end of each round.
- Budget-vs-actual: record each source's total pool and show what share is allocated.
