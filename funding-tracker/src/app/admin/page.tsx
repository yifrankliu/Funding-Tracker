import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { addSource, deleteSource, setRole, toggleOfficerSource } from "@/actions/admin";
import type { FundingSource, Profile } from "@/lib/types";
import { sheetsConfigured } from "@/lib/sheets/mirror";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: sourcesData }, { data: profilesData }, { data: osData }] = await Promise.all([
    supabase.from("funding_sources").select("id, name, short_name").order("name"),
    supabase.from("profiles").select("id, email, full_name, role").order("email"),
    supabase.from("officer_sources").select("profile_id, source_id"),
  ]);
  const sources = (sourcesData ?? []) as FundingSource[];
  const profiles = (profilesData ?? []) as Profile[];
  const assigned = new Set((osData ?? []).map((r) => `${r.profile_id}:${r.source_id}`));

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Admin</h1>

      <section className="card mt-6">
        <h2 className="font-semibold">Funding sources</h2>
        <p className="mt-1 text-sm text-slate-600">Each organization that gives money to clubs. Officers upload on behalf of one of these.</p>
        <table className="table mt-3">
          <thead>
            <tr>
              <th>Name</th>
              <th>Short name</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.short_name}</td>
                <td className="text-right">
                  <ActionForm action={deleteSource} className="inline">
                    <input type="hidden" name="id" value={s.id} />
                    <button className="text-xs text-slate-400 hover:text-red-600">delete</button>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ActionForm action={addSource} className="mt-3 flex flex-wrap gap-2" successText="Added">
          <input name="name" placeholder="Full name, e.g. Asian American Cultural Center" className="input max-w-sm" required />
          <input name="short_name" placeholder="Short, e.g. AACC" className="input max-w-[10rem]" />
          <button className="btn-primary">Add source</button>
        </ActionForm>
      </section>

      <section className="card mt-6 overflow-auto">
        <h2 className="font-semibold">Members</h2>
        <p className="mt-1 text-sm text-slate-600">
          Anyone who signs in with an allowed email appears here as a viewer. Make them an officer and tick the sources they may upload for. Admins can upload for any source.
        </p>
        <table className="table mt-3">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              {sources.map((s) => (
                <th key={s.id} className="text-center" title={s.name}>
                  {s.short_name || s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="font-medium">{p.full_name ?? p.email}</div>
                  {p.full_name && <div className="text-xs text-slate-500">{p.email}</div>}
                </td>
                <td>
                  <ActionForm action={setRole} className="flex items-center gap-1">
                    <input type="hidden" name="profile_id" value={p.id} />
                    <select name="role" defaultValue={p.role} className="input w-28 py-1">
                      <option value="viewer">viewer</option>
                      <option value="officer">officer</option>
                      <option value="admin">admin</option>
                    </select>
                    <button className="btn-secondary py-1">Set</button>
                  </ActionForm>
                </td>
                {sources.map((s) => {
                  const on = assigned.has(`${p.id}:${s.id}`);
                  return (
                    <td key={s.id} className="text-center">
                      <ActionForm action={toggleOfficerSource} className="inline">
                        <input type="hidden" name="profile_id" value={p.id} />
                        <input type="hidden" name="source_id" value={s.id} />
                        <input type="hidden" name="enable" value={on ? "0" : "1"} />
                        <button
                          className={`h-6 w-6 rounded border text-xs ${on ? "border-blue-800 bg-blue-800 text-white" : "border-slate-300 bg-white text-transparent hover:border-slate-500"}`}
                          title={on ? "Remove access" : "Grant access"}
                          disabled={p.role === "admin"}
                        >
                          ✓
                        </button>
                      </ActionForm>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card mt-6 text-sm">
        <h2 className="font-semibold">Integrations</h2>
        <ul className="mt-2 space-y-1 text-slate-700">
          <li>
            Google Sheets mirror: {sheetsConfigured() ? <span className="text-green-700">configured</span> : <span className="text-amber-700">not configured — set GOOGLE_* variables (see README)</span>}
          </li>
          <li>
            AI column mapping: {process.env.ANTHROPIC_API_KEY ? <span className="text-green-700">enabled</span> : <span className="text-amber-700">off — using keyword heuristics (set ANTHROPIC_API_KEY)</span>}
          </li>
        </ul>
      </section>
    </Shell>
  );
}
