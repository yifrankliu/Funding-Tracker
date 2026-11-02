"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeName } from "@/lib/parse/normalize";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function addAlias(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const clubId = String(formData.get("club_id") ?? "");
  const display = String(formData.get("alias") ?? "").trim();
  const alias = normalizeName(display);
  if (!clubId || !alias) return { ok: false, error: "Alias cannot be empty" };
  const supabase = await createClient();
  const { error } = await supabase.from("club_aliases").insert({ alias, display, club_id: clubId });
  if (error) return { ok: false, error: error.code === "23505" ? "That name already points to a club" : error.message };
  revalidatePath("/clubs");
  return { ok: true };
}

export async function removeAlias(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const alias = String(formData.get("alias") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("club_aliases").delete().eq("alias", alias);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/clubs");
  return { ok: true };
}

export async function renameClub(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const clubId = String(formData.get("club_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!clubId || !name) return { ok: false, error: "Name cannot be empty" };
  const supabase = await createClient();
  const { error } = await supabase.from("clubs").update({ name }).eq("id", clubId);
  if (error) return { ok: false, error: error.message };
  // Keep the new name resolvable as an alias too.
  await supabase.from("club_aliases").upsert({ alias: normalizeName(name), display: name, club_id: clubId }, { onConflict: "alias" });
  revalidatePath("/clubs");
  revalidatePath("/");
  return { ok: true };
}

export async function mergeClubs(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const from = String(formData.get("from") ?? "");
  const into = String(formData.get("into") ?? "");
  if (!from || !into || from === into) return { ok: false, error: "Choose two different clubs" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_clubs", { p_from: from, p_into: into });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/clubs");
  revalidatePath("/");
  return { ok: true };
}
