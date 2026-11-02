import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** Loads the signed-in user's profile for Server Components; redirects to /login if signed out. */
export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data } = await supabase.from("profiles").select("id, email, full_name, role").eq("id", user.id).single();
  if (!data) {
    // Profile trigger has not run yet (very first request after sign-up). Fall back to a viewer profile.
    return { id: user.id, email: user.email ?? "", full_name: null, role: "viewer" };
  }
  return data as Profile;
}

export async function requireAdmin(): Promise<Profile> {
  const p = await requireProfile();
  if (p.role !== "admin") redirect("/?error=admins_only");
  return p;
}
