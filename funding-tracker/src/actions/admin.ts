"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/actions/clubs";

const ROLES = ["admin", "officer", "viewer"] as const;

export async function addSource(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const short = String(formData.get("short_name") ?? "").trim() || null;
  if (!name) return { ok: false, error: "Name is required" };
  const supabase = await createClient();
  const { error } = await supabase.from("funding_sources").insert({ name, short_name: short });
  if (error) return { ok: false, error: error.code === "23505" ? "A source with that name exists" : error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteSource(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("funding_sources").delete().eq("id", id);
  if (error) return { ok: false, error: error.code === "23503" ? "This source has uploads; it cannot be deleted" : error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function setRole(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("profile_id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!ROLES.includes(role as (typeof ROLES)[number])) return { ok: false, error: "Unknown role" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id === id && role !== "admin") return { ok: false, error: "You cannot remove your own admin role" };
  const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function toggleOfficerSource(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profileId = String(formData.get("profile_id") ?? "");
  const sourceId = String(formData.get("source_id") ?? "");
  const enable = formData.get("enable") === "1";
  const supabase = await createClient();
  const { error } = enable
    ? await supabase.from("officer_sources").upsert({ profile_id: profileId, source_id: sourceId })
    : await supabase.from("officer_sources").delete().eq("profile_id", profileId).eq("source_id", sourceId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}
