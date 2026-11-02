"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/actions/clubs";
import { syncToGoogleSheets } from "@/lib/sheets/mirror";

/** Deletes an upload and its allocations, restoring the upload it had superseded (if any). */
export async function deleteUpload(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("upload_id") ?? "");
  if (!id) return { ok: false, error: "Missing upload id" };
  const supabase = await createClient();

  const { data: storagePath, error } = await supabase.rpc("delete_upload", { p_upload_id: id });
  if (error) return { ok: false, error: error.message };

  if (storagePath) {
    await supabase.storage.from("uploads").remove([storagePath as string]); // best effort
  }
  try {
    await syncToGoogleSheets();
  } catch {
    // mirror is best effort
  }

  revalidatePath("/uploads");
  revalidatePath("/");
  revalidatePath("/clubs");
  return { ok: true };
}
