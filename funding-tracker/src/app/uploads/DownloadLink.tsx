"use client";

import { createClient } from "@/lib/supabase/client";

export function DownloadLink({ path, name }: { path: string; name: string }) {
  async function download() {
    const supabase = createClient();
    const { data, error } = await supabase.storage.from("uploads").createSignedUrl(path, 60);
    if (error || !data) return alert(error?.message ?? "Could not create download link");
    window.open(data.signedUrl, "_blank");
  }
  return (
    <button onClick={download} className="text-blue-800 hover:underline">
      {name}
    </button>
  );
}
