import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { UploadWizard } from "./UploadWizard";
import type { FundingSource } from "@/lib/types";
import type { KnownName } from "@/lib/parse/normalize";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const profile = await requireProfile();
  if (profile.role === "viewer") redirect("/?error=officers_only");

  const supabase = await createClient();

  // Which sources may this person upload for?
  let sources: FundingSource[] = [];
  if (profile.role === "admin") {
    const { data } = await supabase.from("funding_sources").select("id, name, short_name").order("name");
    sources = (data ?? []) as FundingSource[];
  } else {
    const { data } = await supabase
      .from("officer_sources")
      .select("funding_sources(id, name, short_name)")
      .eq("profile_id", profile.id);
    sources = ((data ?? []) as unknown as { funding_sources: FundingSource | null }[])
      .map((r) => r.funding_sources)
      .filter((s): s is FundingSource => Boolean(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const [{ data: clubs }, { data: aliases }, { data: periods }] = await Promise.all([
    supabase.from("clubs").select("id, name").order("name"),
    supabase.from("club_aliases").select("alias, display, club_id"),
    supabase.from("uploads").select("academic_year, period").order("created_at", { ascending: false }).limit(200),
  ]);

  const clubName = new Map((clubs ?? []).map((c) => [c.id as string, c.name as string]));
  const known: KnownName[] = [
    ...(clubs ?? []).map((c) => ({
      club_id: c.id as string,
      club_name: c.name as string,
      text: (c.name as string).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      display: c.name as string,
    })),
    ...(aliases ?? [])
      .filter((a) => clubName.has(a.club_id as string))
      .map((a) => ({
        club_id: a.club_id as string,
        club_name: clubName.get(a.club_id as string)!,
        text: a.alias as string,
        display: a.display as string,
      })),
  ];

  const seenPeriods = [...new Set((periods ?? []).map((p) => p.period as string))];
  const seenYears = [...new Set((periods ?? []).map((p) => p.academic_year as string))];

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Upload a funding spreadsheet</h1>
      <p className="mt-1 text-sm text-slate-600">
        Drop the sheet exactly as your office keeps it. We will work out the columns, match club names, and show you
        everything before anything is saved.
      </p>
      {sources.length === 0 ? (
        <div className="card mt-6 text-sm text-slate-700">
          You are not assigned to any funding source yet. Ask an admin to add you under <b>Admin → Members</b>.
        </div>
      ) : (
        <UploadWizard sources={sources} known={known} seenPeriods={seenPeriods} seenYears={seenYears} />
      )}
    </Shell>
  );
}
